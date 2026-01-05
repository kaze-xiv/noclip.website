use physis::common::Platform;
use physis::layer::{InstanceObject, Layer, LayerEntryData, LayerGroup};
use physis::ReadableFile;
use physis::sgb::Sgb;
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
        let lgb = LayerGroup::from_existing(Platform::Win32, data.as_slice()).unwrap();
        let walked = walk(lgb.chunks.into_iter().flat_map(|x| x.layers));

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
fn walk(layers: impl IntoIterator<Item = Layer>) -> InstanceWalker {
    let mut models: Vec<String> = vec![];
    let mut sgbs: Vec<String> = vec![];
    let mut objects: Vec<FlatLayoutObject> = vec![];

    for layer in layers {
        let festival_id = layer.header.festival_id;
        let festival_phase_id = layer.header.festival_phase_id;

        for obj in layer.objects {
            // wtf
            let asset_type = unsafe { std::mem::transmute(obj.asset_type as i32) };
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
                        festival_id, festival_phase_id,
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
                        festival_id, festival_phase_id,

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
                    festival_id, festival_phase_id,

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
    pub discoveredModels: Vec<String>,
    pub discoveredSgbs: Vec<String>,
    pub objects: Vec<FlatLayoutObject>,
}

#[wasm_bindgen]
impl FFXIVSgb {
    pub fn parse(data: Vec<u8>) -> FFXIVSgb {
        let sgb = Sgb::from_existing(Platform::Win32, data.as_slice()).unwrap();

        let walked = walk(sgb.chunks.into_iter().flat_map(|x| x.layers));


        FFXIVSgb {
            discoveredModels: walked.discoveredModels,
            discoveredSgbs: walked.discoveredSgbs,
            objects: walked.objects,
        }
    }
}