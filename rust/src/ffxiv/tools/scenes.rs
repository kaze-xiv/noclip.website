use anyhow::anyhow;
use itertools::Itertools;
use naga::FastHashMap;
use physis::excel::{Row, Sheet};
use physis::resource::SqPackResource;
use physis::Language;
use std::cmp::Ordering;
use std::env;

#[allow(dead_code)]
pub fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let game_path = args[1].clone();
    let mut resource = SqPackResource::from_existing(game_path.as_str());

    let content_finder_header = resource
        .read_excel_sheet_header("ContentFinderCondition")
        .unwrap();
    let content_finder_sheet = resource
        .read_excel_sheet(
            &content_finder_header,
            "ContentFinderCondition",
            Language::English,
        )
        .unwrap();

    let mut territory_content_finder_map: FastHashMap<u16, &String> = FastHashMap::default();
    for row_id in 0..content_finder_header.header.row_count {
        let row = content_finder_sheet.row(row_id).unwrap();
        let territory_type = *row.columns[1].into_u16().unwrap();
        let content_finder_name = row.columns[43].into_string().unwrap();
        territory_content_finder_map.insert(territory_type, content_finder_name);
    }

    let territory_header = resource.read_excel_sheet_header("TerritoryType").unwrap();
    let territory_sheet = resource
        .read_excel_sheet(&territory_header, "TerritoryType", Language::None)
        .unwrap();

    let place_name_header = resource.read_excel_sheet_header("PlaceName").unwrap();
    let place_name_sheet = resource
        .read_excel_sheet(&place_name_header, "PlaceName", Language::English)
        .unwrap();

    let mut territory_rows: Vec<TerritoryRow> = vec![];

    for page in &territory_sheet.pages {
        for entry in page.entries.iter().skip(2) {
            let id = entry.id;
            let territory_row = territory_sheet.row(id).ok_or(anyhow!("missing row id"))?;
            let parsed = TerritoryRow::from(id, territory_row);
            if parsed.bg.len() == 0 {
                continue;
            }
            territory_rows.push(parsed);
        }
    }

    territory_rows.sort_by(|a, b| a.bg.cmp(b.bg));
    territory_rows.dedup_by(|a, b| a.bg.eq(b.bg));

    territory_rows.sort_by(|a, b| a.place_name_region_id.cmp(&b.place_name_region_id));
    for (region_id, rows) in territory_rows
        .iter()
        .into_group_map_by(|x| x.place_name_region_id)
        .iter()
        .sorted_by(|a, b| (*a).0.cmp((*b).0))
    {
        let region_name = match find_place_name(&place_name_sheet, *region_id).as_str() {
            "" => "(no name)",
            a => a,
        };
        println!("\"{region_name}\",",);
        for row in rows.iter().sorted_by(|a, b| sort_territories(a, b)) {
            let zone_name = find_place_name(&place_name_sheet, row.place_name_zone_id);
            let place_name = find_place_name(&place_name_sheet, row.place_name_id);
            let place_combined_name = match (zone_name.len(), place_name.len()) {
                (0, 0) => "(empty name)",
                (0, _) => place_name,
                (_, 0) => zone_name,
                _ => &format!("{zone_name} - {place_name}"),
            };
            let content_finder_name = territory_content_finder_map.get(&(row.id as u16));
            let display_name = match content_finder_name {
                None => place_combined_name,
                Some(cf) => &format!("{place_combined_name} (Duty: {cf})"),
            };

            println!("new FFXIVMapDesc(`{}`, `{display_name}`),", row.bg);
        }
    }

    Ok(())
}

fn sort_territories(a: &TerritoryRow, b: &TerritoryRow) -> Ordering {
    let a_type = a.bg.split("/").nth(2).unwrap();
    let b_type = b.bg.split("/").nth(2).unwrap();
    match a_type.cmp(b_type).reverse() {
        Ordering::Equal => match a.place_name_zone_id.cmp(&b.place_name_zone_id) {
            Ordering::Equal => a.place_name_id.cmp(&b.place_name_id),
            a => a,
        },

        cmp => cmp,
    }
}

struct TerritoryRow<'a> {
    id: u32,
    bg: &'a str,
    place_name_region_id: u16,
    place_name_zone_id: u16,
    place_name_id: u16,
}

impl<'a> TerritoryRow<'a> {
    fn from(id: u32, row: &'a Row) -> TerritoryRow<'a> {
        let place_name_zone_id_raw = *row.columns[4].into_u16().expect("Column 1 wasn't u16");
        // override for some untranslated strings
        let place_name_zone_id = match place_name_zone_id_raw {
            501 => 358,  // ウルヴズジェイル => Wolves' Den Pier (no perfect match),
            503 => 1484, // ゴールドソーサー => The Gold Saucer
            a => a,
        };

        TerritoryRow {
            id,
            bg: row.columns[1]
                .into_string()
                .expect("Column 1 wasn't string"),
            place_name_region_id: *row.columns[3].into_u16().expect("Column 1 wasn't u16"),
            place_name_zone_id,
            place_name_id: *row.columns[5].into_u16().expect("Column 1 wasn't u16"),
        }
    }
}

fn find_place_name(place_name_sheet: &Sheet, id: u16) -> &String {
    place_name_sheet
        .row(id.into())
        .expect("Couldn't find name")
        .columns[0]
        .into_string()
        .unwrap()
}
