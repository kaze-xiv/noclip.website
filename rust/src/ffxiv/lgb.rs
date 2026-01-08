use physis::common::Platform;
use physis::layer::{InstanceObject, Layer, LayerEntryData, ScnSection};
use physis::lgb::Lgb;
use physis::sgb::Sgb;
use physis::tmb::{TimelineNodeData, Tmdh};
use physis::ReadableFile;
use std::any::Any;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct FFXIVLgb {
    pub discoveredModels: Vec<String>,
    pub discoveredSgbs: Vec<String>,
    pub objects: Vec<FlatLayoutObject>,
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct FlatLayoutObject {
    pub layer_type: i32,
    pub asset_name: Option<String>,
    pub festival_id: u16,
    pub festival_phase_id: u16,
    pub translation: Vec<f32>,
    pub rotation: Vec<f32>,
    pub scale: Vec<f32>,
}

#[wasm_bindgen]
impl FFXIVLgb {
    pub fn parse(data: Vec<u8>) -> FFXIVLgb {
        let lgb = Lgb::from_existing(Platform::Win32, data.as_slice()).unwrap();
        let walked = walk(lgb.chunks.iter().flat_map(|x| &x.layers));

        FFXIVLgb {
            discoveredModels: walked.discoveredModels,
            discoveredSgbs: walked.discoveredSgbs,
            objects: walked.objects,
        }
    }
}

struct InstanceWalker {
    pub discoveredModels: Vec<String>,
    pub discoveredSgbs: Vec<String>,
    pub objects: Vec<FlatLayoutObject>,
}

// this is supposed to be generic but rust is hard
fn walk<'a>(layers: impl Iterator<Item = &'a Layer>) -> InstanceWalker {
    let mut models: Vec<String> = vec![];
    let mut sgbs: Vec<String> = vec![];
    let mut objects: Vec<FlatLayoutObject> = vec![];

    for layer in layers {
        let festival_id = layer.header.festival_id;
        let festival_phase_id = layer.header.festival_phase_id;

        for obj in &layer.objects {
            // wtf
            let asset_type = obj.asset_type as i32;
            let data = &obj.data;
            match data {
                LayerEntryData::BG(bg) => {
                    if festival_id == 0 {
                        models.push(bg.asset_path.value.clone());
                    }
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(bg.asset_path.value.clone()),
                        translation: obj.transform.translation.to_vec(),
                        rotation: obj.transform.rotation.to_vec(),
                        scale: obj.transform.scale.to_vec(),
                        festival_id,
                        festival_phase_id,
                    })
                }
                LayerEntryData::SharedGroup(sg) => {
                    let asset_path = &sg.asset_path.value;
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(asset_path.clone()),
                        translation: obj.transform.translation.to_vec(),
                        rotation: obj.transform.rotation.to_vec(),
                        scale: obj.transform.scale.to_vec(),
                        festival_id,
                        festival_phase_id,
                    });
                    if festival_id == 0 {
                        sgbs.push(asset_path.clone());
                    }
                }
                _ => objects.push(FlatLayoutObject {
                    layer_type: asset_type,
                    asset_name: None,
                    translation: obj.transform.translation.to_vec(),
                    rotation: obj.transform.rotation.to_vec(),
                    scale: obj.transform.scale.to_vec(),
                    festival_id,
                    festival_phase_id,
                }),
            }
        }
    }
    InstanceWalker {
        discoveredModels: models,
        discoveredSgbs: sgbs,
        objects: objects,
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct FFXIVSgb {
    pub(crate) inner: Sgb,
    pub discoveredModels: Vec<String>,
    pub discoveredSgbs: Vec<String>,
}

#[wasm_bindgen]
impl FFXIVSgb {
    pub fn parse(data: Vec<u8>) -> FFXIVSgb {
        let sgb = Sgb::from_existing(Platform::Win32, data.as_slice()).unwrap();

        let walk = walk(
            sgb.sections
                .iter()
                .flat_map(|x| &x.layer_groups)
                .flat_map(|x| &x.layers),
        );
        FFXIVSgb {
            inner: sgb,
            discoveredModels: walk.discoveredModels.clone(),
            discoveredSgbs: walk.discoveredSgbs.clone(),
        }
    }

    pub fn flatten_objects(&self) -> Vec<FlatLayoutObject> {
        walk(
            self.inner
                .sections
                .iter()
                .flat_map(|x| &x.layer_groups)
                .flat_map(|x| &x.layers),
        )
        .objects
    }

    pub fn animate(&self) {
        for section in &self.inner.sections {
            let timelines = &section.timelines.timelines;
            for timeline in timelines {
                for node in &timeline.tmb.nodes {
                    match &node.data {
                        TimelineNodeData::Tmdh(node) => {
                            println!("Tmdh");
                        }
                        TimelineNodeData::Tmal(node) => {
                            println!("Tmal")
                        }
                        TimelineNodeData::Tmac(node) => {
                            println!("Tmac")
                        }
                        TimelineNodeData::Tmtr(node) => {
                            println!("Tmtr")
                        }
                        TimelineNodeData::Tmfc(node) => {
                            println!("Tmfc")
                        }
                        TimelineNodeData::C013(node) => {
                            println!("C013")
                        }
                        TimelineNodeData::Unknown(_) => {
                            println!("Unknown")
                        }
                    }
                }
            }

            for layer_group in &section.layer_groups {
                for layer in &layer_group.layers {
                    for object in &layer.objects {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use binrw::{BinWrite, Endian};
    use physis::tmb::Tmb;
    use std::fs::{read, File};
    use std::io::{BufWriter, Cursor, Write};
    use std::path::PathBuf;

    #[test]
    fn test_invalid() {
        let path = PathBuf::from("/data/Projects/noclip.website/data/FFXIV/bgcommon/world/aet/shared/for_bg/sgbg_w_aet_001_01a.sgb");
        let sgb = Sgb::from_existing(Platform::Win32, &read(path.clone()).unwrap()).unwrap();

        let wrapper = FFXIVSgb::parse(read(path.clone()).unwrap());
        wrapper.animate();

        let mut file = File::create("/tmp/aether.tmb").unwrap();
        let mut writer = BufWriter::new(file);
        // let mut cursor = Cursor::new(&mut file);
        let tmb = &sgb.sections[0].timelines.timelines[0].tmb;
        // Tmb::write_options(tmb, &mut writer, Endian::Little, ()).unwrap();
        // writer.flush().unwrap();
        println!("Wait")
    }
}
