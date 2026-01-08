use euclid::Angle;
use euclid::default::{Rotation3D, Transform3D, Vector3D};
use physis::layer::{Layer, LayerEntryData, Transformation};
use crate::ffxiv::layer::object::FlatLayoutObject;

pub fn convert_transform(original: Transformation) -> Transform3D<f32> {
    let rot = Rotation3D::euler(
        Angle::radians(original.rotation[0]),
        Angle::radians(original.rotation[1]),
        Angle::radians(original.rotation[2]),
    );
    Transform3D::identity()
        .then_scale(original.scale[0], original.scale[1], original.scale[2])
        .then(&rot.to_transform())
        .then_translate(Vector3D::from(original.translation))
}

pub fn walk<'a>(layers: impl Iterator<Item = &'a Layer>) -> Vec<FlatLayoutObject> {
    let mut objects: Vec<FlatLayoutObject> = vec![];

    for layer in layers {
        let festival_id = layer.header.festival_id;
        let festival_phase_id = layer.header.festival_phase_id;

        for obj in &layer.objects {
            // wtf
            let asset_type = obj.asset_type as i32;
            let data = &obj.data;
            let instance_id = obj.instance_id;
            let mm = convert_transform(obj.transform);
            match data {
                LayerEntryData::BG(bg) => {
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(bg.asset_path.value.clone()),
                        festival_id,
                        festival_phase_id,
                        instance_id,
                        mm,
                    })
                }
                LayerEntryData::SharedGroup(sg) => {
                    let asset_path = &sg.asset_path.value;
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(asset_path.clone()),
                        festival_id,
                        festival_phase_id,
                        instance_id,
                        mm,
                    });
                }

                LayerEntryData::EnvLocation(data) => {
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(data.env_map_asset_path.value.clone()),
                        festival_id,
                        festival_phase_id,
                        instance_id,
                        mm,
                    });
                }
                _ => objects.push(FlatLayoutObject {
                    layer_type: asset_type,
                    asset_name: None,
                    festival_id,
                    festival_phase_id,
                    instance_id,
                    mm,
                }),
            }
        }
    }
    objects
}
