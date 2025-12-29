use physis::layer::{LayerEntryData, LayerGroup};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct FFXIVLgb {
    pub discoveredModels: Vec<String>,
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
        let objs = layers.flat_map(|x| &x.objects);

        let mut models: Vec<String> = vec![];
        let mut objects: Vec<FlatLayoutObject> = vec![];

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
            objects: objects,
        }
    }
}
