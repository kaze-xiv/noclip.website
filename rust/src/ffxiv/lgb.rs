use physis::layer::{InstanceObject, LayerEntryData, LayerGroup};
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
    pub translation: Vec<f32>,
    pub rotation: Vec<f32>,
    pub scale: Vec<f32>,
}

#[wasm_bindgen]
impl FFXIVLgb {
    pub fn parse(data: Vec<u8>) -> FFXIVLgb {
        let lgb = LayerGroup::from_existing(data.as_slice()).unwrap();
        let layers = lgb.chunks.iter().flat_map(|x| &x.layers);
        // TODO filter festivals
        let layers = layers.filter(|x| x.header.festival_id == 0);
        let objs = layers.flat_map(|x| &x.objects);

        let mut models: Vec<String> = vec![];
        let mut objects: Vec<FlatLayoutObject> = vec![];
        let mut sgbs: Vec<String> = vec![];

        for obj in objs.into_iter() {
            // wtf
            let asset_type = unsafe { std::mem::transmute(obj.asset_type as i32) };
            let data = &obj.data;
            match data {
                LayerEntryData::BG(bg) => {
                    models.push(bg.asset_path.value.clone());
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(bg.asset_path.value.clone()),
                        translation: obj.transform.translation.to_vec(),
                        rotation: obj.transform.rotation.to_vec(),
                        scale: obj.transform.scale.to_vec(),
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
                    });
                    sgbs.push(asset_path.clone());
                }
                _ => objects.push(FlatLayoutObject {
                    layer_type: asset_type,
                    asset_name: None,
                    translation: obj.transform.translation.to_vec(),
                    rotation: obj.transform.rotation.to_vec(),
                    scale: obj.transform.scale.to_vec(),
                }),
            }
        }
        FFXIVLgb {
            discoveredModels: models,
            discoveredSgbs: sgbs,
            objects: objects,
        }
    }
}

struct InstanceWalker {
    pub discoveredModels: Vec<String>,
    pub discoveredSgbs: Vec<String>,
    pub objects: Vec<FlatLayoutObject>,
}

// this is supposed to be generic but rust is hard
fn walk(objs: Vec<InstanceObject>) -> InstanceWalker {
    let mut models: Vec<String> = vec![];
    let mut sgbs: Vec<String> = vec![];
    let mut objects: Vec<FlatLayoutObject> = vec![];

    for obj in objs {
        // wtf
        let asset_type = unsafe { std::mem::transmute(obj.asset_type as i32) };
        let data = &obj.data;
        match data {
            LayerEntryData::BG(bg) => {
                models.push(bg.asset_path.value.clone());
                objects.push(FlatLayoutObject {
                    layer_type: asset_type,
                    asset_name: Some(bg.asset_path.value.clone()),
                    translation: obj.transform.translation.to_vec(),
                    rotation: obj.transform.rotation.to_vec(),
                    scale: obj.transform.scale.to_vec(),
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
                });
                sgbs.push(asset_path.clone());
            }
            _ => objects.push(FlatLayoutObject {
                layer_type: asset_type,
                asset_name: None,
                translation: obj.transform.translation.to_vec(),
                rotation: obj.transform.rotation.to_vec(),
                scale: obj.transform.scale.to_vec(),
            }),
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
        let sgb = Sgb::from_existing(data.as_slice()).unwrap();
        let layers = sgb.chunks.iter().flat_map(|x| &x.layers);
        let objs = layers.flat_map(|x| &x.objects);

        let mut models: Vec<String> = vec![];
        let mut objects: Vec<FlatLayoutObject> = vec![];
        let mut sgbs: Vec<String> = vec![];

        for obj in objs.into_iter() {
            // wtf
            let asset_type = unsafe { std::mem::transmute(obj.asset_type as i32) };
            let data = &obj.data;
            match data {
                LayerEntryData::BG(bg) => {
                    models.push(bg.asset_path.value.clone());
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(bg.asset_path.value.clone()),
                        translation: obj.transform.translation.to_vec(),
                        rotation: obj.transform.rotation.to_vec(),
                        scale: obj.transform.scale.to_vec(),
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
                    });
                    sgbs.push(asset_path.clone());
                }
                _ => objects.push(FlatLayoutObject {
                    layer_type: asset_type,
                    asset_name: None,
                    translation: obj.transform.translation.to_vec(),
                    rotation: obj.transform.rotation.to_vec(),
                    scale: obj.transform.scale.to_vec(),
                }),
            }
        }
        FFXIVSgb {
            discoveredModels: models,
            discoveredSgbs: sgbs,
            objects: objects,
        }
    }
}