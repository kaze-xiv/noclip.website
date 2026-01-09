use euclid::default::Transform3D;
use physis::layer::{InstanceObject, LayerEntryData};
use wasm_bindgen::prelude::wasm_bindgen;
use crate::ffxiv::layer::util::convert_transform;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct LayerObject {
    pub object_type: i32,
    pub asset_name: Option<String>,
    pub instance_id: u32,
    pub(crate) mm: Transform3D<f32>,
}


#[wasm_bindgen]
impl LayerObject {
    pub fn write_model_matrix(&self, target: &mut [f32]) {
        target.copy_from_slice(&self.mm.to_array())
    }
    
    pub(crate) fn from_physis(physis: &InstanceObject) -> Self {
        // wtf
        let asset_type = physis.asset_type as i32;
        let data = &physis.data;
        let instance_id = physis.instance_id;
        let mm = convert_transform(physis.transform);
        match data {
            LayerEntryData::BG(bg) => {
                LayerObject {
                    object_type: asset_type,
                    asset_name: Some(bg.asset_path.value.clone()),
                    instance_id,
                    mm,
                }
            }
            LayerEntryData::SharedGroup(sg) => {
                let asset_path = &sg.asset_path.value;
                LayerObject {
                    object_type: asset_type,
                    asset_name: Some(asset_path.clone()),
                    instance_id,
                    mm,
                }
            }

            LayerEntryData::EnvLocation(data) => {
                LayerObject {
                    object_type: asset_type,
                    asset_name: Some(data.env_map_asset_path.value.clone()),
                    instance_id,
                    mm,
                }
            }
            _ => LayerObject {
                object_type: asset_type,
                asset_name: None,
                instance_id,
                mm,
            },
        }
    }
}