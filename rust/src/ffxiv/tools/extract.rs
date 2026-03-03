use anyhow::{anyhow, Context};
use naga::FastHashSet;
use physis::excel::{Row, Sheet};
use physis::layer::{InstanceObject, LayerEntryData};
use physis::lgb::Lgb;
use physis::lvb::Lvb;
use physis::model::MDL;
use physis::mtrl::Material;
use physis::resource::{Resource, SqPackResource};
use physis::sgb::Sgb;
use physis::tera::Terrain;
use physis::{Language, ReadableFile};
use std::env;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

#[allow(dead_code)]
pub fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let game_path = args[1].clone();
    let mut resource = SqPackResource::from_existing(game_path.as_str());
    resource.preload_index_files();

    let map_header = resource.read_excel_sheet_header("Map").unwrap();
    let map_sheet = resource
        .read_excel_sheet(&map_header, "Map", Language::None)
        .unwrap();

    let territory_header = resource.read_excel_sheet_header("TerritoryType").unwrap();
    let territory_sheet = resource
        .read_excel_sheet(&territory_header, "TerritoryType", Language::None)
        .unwrap();

    let mut extract = Extract {
        resource,
        territory_sheet,
        target_directory: PathBuf::from("../data/FFXIV"),
        done: Default::default(),
        fail: Default::default(),
    };

    // extract clouds lol
    for i in 1..=30 {
        extract
            .extract(format!("bgcommon/nature/cloud/texture/cloud_{:03}.tex", i).as_str())
            .ok();
    }

    for i in 1..=70 {
        extract
            .extract(format!("bgcommon/nature/cloud/texture/cloudside_{:03}.tex", i).as_str())
            .ok();
    }

    for page in &map_sheet.pages {
        for entry in page.entries.iter().skip(78) {
            let id = entry.id;
            let map_row = map_sheet.row(id).ok_or(anyhow!("missing row id"))?;
            extract.extract_map(&map_row).ok();
            println!("Did {id}");
        }
    }

    Ok(())
}

struct Extract {
    resource: SqPackResource,
    territory_sheet: Sheet,
    target_directory: PathBuf,
    done: FastHashSet<String>,
    fail: FastHashSet<String>,
}

impl Extract {
    fn extract_map(&mut self, map_row: &Row) -> anyhow::Result<()> {
        let territory_bg = self.get_territory_bg(map_row)?;
        if territory_bg.len() == 0 {
            return Ok(());
        }

        self.extract(format!("bg/{}.lcb", territory_bg).as_str())?;
        self.extract(format!("bg/{}.svb", territory_bg).as_str())?;
        self.extract_lvb(format!("bg/{}.lvb", territory_bg).as_str())?;

        Ok(())
    }

    fn get_territory_bg(&mut self, map_row: &Row) -> anyhow::Result<String> {
        let bg = map_row.columns[6]
            .into_string()
            .ok_or(anyhow!("Column 6 wasn't bg string"))?;

        let territory_id = *map_row.columns[16]
            .into_u16()
            .ok_or(anyhow!("Column 7 wasn't territory id"))?;

        let territory = &mut self
            .territory_sheet
            .row(territory_id.into())
            .ok_or(anyhow!("missing territory id {}", territory_id))?;

        let territory_bg = territory.columns[1]
            .into_string()
            .ok_or(anyhow!("Column 1 wasn't territory bg string"))?;
        Ok(territory_bg.into())
    }

    fn extract_lvb(&mut self, game_path: &str) -> anyhow::Result<()> {
        let lvb = match self.extract_parse::<Lvb>(game_path)? {
            None => return Ok(()),
            Some(r) => r,
        };
        for section in lvb.sections {
            let bg_path = section.general.bg_path.value;
            // Tera
            let tera = match self
                .extract_parse::<Terrain>(format!("{}/bgplate/terrain.tera", bg_path).as_str())?
            {
                None => continue,
                Some(r) => r,
            };
            for plate_index in 0..tera.plates.len() {
                self.extract_mdl(format!("{}/bgplate/{:04}.mdl", bg_path, plate_index).as_str())?;
            }

            // lgbs
            for lgb in section.lgb_paths {
                self.extract_lgb(lgb.as_str())?;
            }
        }
        Ok(())
    }

    fn extract_lgb(&mut self, game_path: &str) -> anyhow::Result<()> {
        let lgb = match self.extract_parse::<Lgb>(game_path)? {
            None => return Ok(()),
            Some(r) => r,
        };
        for object in lgb
            .chunks
            .iter()
            .flat_map(|x| &x.layers)
            .flat_map(|x| &x.objects)
        {
            self.extract_instance_object(object)?
        }
        Ok(())
    }

    fn extract_sgb(&mut self, game_path: &str) -> anyhow::Result<()> {
        let sgb = match self.extract_parse::<Sgb>(game_path)? {
            None => return Ok(()),
            Some(r) => r,
        };
        for inner in sgb.sections.iter().flat_map(|x| &x.lgb_paths) {
            self.extract_sgb(inner)?
        }
        for object in sgb
            .sections
            .iter()
            .flat_map(|x| &x.layer_groups)
            .flat_map(|x| &x.layers)
            .flat_map(|x| &x.objects)
        {
            self.extract_instance_object(object)?
        }
        Ok(())
    }

    fn extract_instance_object(&mut self, instance_object: &InstanceObject) -> anyhow::Result<()> {
        match &instance_object.data {
            LayerEntryData::BG(bg) => self.extract_mdl(bg.asset_path.value.as_str()),
            LayerEntryData::SharedGroup(group) => self.extract_sgb(group.asset_path.value.as_str()),
            _ => Ok(()),
        }
    }

    fn extract_mdl(&mut self, game_path: &str) -> anyhow::Result<()> {
        let mdl = match self.extract_parse::<MDL>(game_path)? {
            None => return Ok(()),
            Some(r) => r,
        };
        for material_name in mdl.material_names {
            self.extract_mtrl(material_name.as_str())
                .with_context(|| format!("Failed to extract material {material_name}"))
                .ok();
        }
        Ok(())
    }
    fn extract_mtrl(&mut self, game_path: &str) -> anyhow::Result<()> {
        let material = match self.extract_parse::<Material>(game_path)? {
            None => return Ok(()),
            Some(r) => r,
        };
        for texture_name in &material.texture_paths {
            let texture = self
                .extract(texture_name.as_str())
                .context(format!("Failed to extract texture {texture_name}"))?;
        }
        Ok(())
    }

    fn extract(&mut self, game_path: &str) -> anyhow::Result<()> {
        if self.done.insert(game_path.to_owned()) {
            extract(&mut self.resource, &mut self.target_directory, game_path)
        } else {
            Ok(())
        }
    }

    fn extract_parse<F: ReadableFile>(&mut self, game_path: &str) -> anyhow::Result<Option<F>> {
        let owned = game_path.to_owned();
        if self.done.insert(owned) {
            extract_parse::<F>(&mut self.resource, &self.target_directory, game_path)
                .map(Some)
                .or_else(|e| {
                    println!("Failed on {game_path}, {e}");
                    self.fail.insert(game_path.to_owned());
                    Ok(None)
                })
        } else {
            Ok(None)
        }
    }
}

fn extract(resource: &mut SqPackResource, target: &PathBuf, game_path: &str) -> anyhow::Result<()> {
    let buf = resource
        .read(game_path)
        .ok_or(anyhow!("File not found {}", game_path))?;
    let mut path = target.clone();
    path.push(game_path);
    let prefix = path
        .parent()
        .ok_or(anyhow!("Couldn't get parent for {:?}", game_path))?;
    std::fs::create_dir_all(prefix)?;

    let file = File::create(path)?;
    BufWriter::new(file).write_all(buf.as_slice())?;
    Ok(())
}

fn extract_parse<F: ReadableFile>(
    resource: &mut SqPackResource,
    target: &PathBuf,
    game_path: &str,
) -> anyhow::Result<F> {
    let buf = resource.read(game_path).ok_or(anyhow!("File not found"))?;
    let mut path = target.clone();
    path.push(game_path);
    let prefix = path
        .parent()
        .ok_or(anyhow!("Couldn't get parent for {:?}", game_path))?;
    std::fs::create_dir_all(prefix)?;

    let file = File::create(path)?;

    BufWriter::new(file).write_all(buf.as_slice())?;
    F::from_existing(resource.platform(), buf.as_slice()).ok_or(anyhow!("Couldn't parse"))
}
