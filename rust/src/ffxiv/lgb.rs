use physis::common::Platform;
use physis::layer::{InstanceObject, Layer, LayerEntryData, ScnSection, ScnTimeline, Transformation};
use physis::lgb::Lgb;
use physis::sgb::Sgb;
use physis::tmb::{Attribute, TimelineNode, TimelineNodeData, Tmac, Tmdh, Tmfc, TmfcData, Tmtr};
use physis::ReadableFile;
use std::any::Any;
use std::collections::HashMap;
use std::convert::{TryFrom, TryInto};
use euclid::Angle;
use euclid::default::{Rotation3D, Transform3D, Translation3D, Vector3D};
use nalgebra_glm::lerp_scalar;
use physis::uld::Timeline;
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
    pub instance_id: u32,
    mm: Transform3D<f32>,
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

fn convert_transform(original: Transformation) -> Transform3D<f32> {
    let rot = Rotation3D::euler(Angle::degrees(original.rotation[0]), Angle::degrees(original.rotation[1]), Angle::degrees(original.rotation[2]));
    Transform3D::identity()
        .then_translate(Vector3D::from(original.translation))
        .then(&rot.to_transform())
        .then_scale(original.scale[0], original.scale[1], original.scale[2])
}

// this is supposed to be generic but rust is hard
fn walk<'a>(layers: impl Iterator<Item=&'a Layer>) -> InstanceWalker {
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
            let instance_id = obj.instance_id;
            let mm = convert_transform(obj.transform);
            match data {
                LayerEntryData::BG(bg) => {
                    if festival_id == 0 {
                        models.push(bg.asset_path.value.clone());
                    }
                    objects.push(FlatLayoutObject {
                        layer_type: asset_type,
                        asset_name: Some(bg.asset_path.value.clone()),
                        // mm:
                        translation: obj.transform.translation.to_vec(),
                        rotation: obj.transform.rotation.to_vec(),
                        scale: obj.transform.scale.to_vec(),
                        festival_id,
                        festival_phase_id, instance_id, mm
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
                        festival_phase_id, instance_id, mm
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
                    festival_phase_id, instance_id, mm
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
    pub animation_controller: AnimationController,
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
        let animation_controller = Self::generate_animation_controller(&sgb);
        FFXIVSgb {
            inner: sgb,
            discoveredModels: walk.discoveredModels,
            discoveredSgbs: walk.discoveredSgbs,
            animation_controller,
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

    fn generate_animation_controller(inner: &Sgb) -> AnimationController {
        let mut out: HashMap<u32, Vec<(TimelineNodeData, Option<Vec<TmfcData>>)>> = HashMap::new();
        for section in &inner.sections {
            for layer_group in &section.layer_groups {
                for layer in &layer_group.layers {
                    for object in &layer.objects {
                        let instance_id = object.instance_id;
                        for timeline in &section.timelines.timelines {
                            let mut animationData: Vec<(TimelineNodeData, Option<Vec<TmfcData>>)> = vec!();
                            let nodes = &timeline.tmb.nodes;
                            let macs: Vec<&Tmac> = timeline.instances.iter()
                                .filter_map(|instance| -> Option<&Tmac> { if instance.instance_id as u32 == instance_id { find_tmac(&timeline.tmb.nodes, instance.tmac_time) } else { None } }).collect();
                            let tmtr_ids = macs.iter().flat_map(|&mac| &mac.tmtr_ids);
                            let tmtrs = tmtr_ids.filter_map(|&id| find_tmtr(&timeline.tmb.nodes, id));
                            let animation_ids = tmtrs.flat_map(|tmtr| &tmtr.animation_ids);
                            let animations: Vec<&TimelineNodeData> = animation_ids.filter_map(|&id| find_node(nodes, id)).collect();
                            for timelineNode in animations {
                                let my_fcurve = match timelineNode {
                                    TimelineNodeData::C013(modelAnimation) => {
                                        find_fcurve(nodes, modelAnimation.tmfc_id).map(|x| &x.data)
                                    }
                                    _ => None,
                                };
                                animationData.push(((*timelineNode).clone(), my_fcurve.map(|x| (*x).clone()).clone()));
                            }
                            out.entry(instance_id).insert_entry(animationData);
                        }
                    }
                }
            }
        }
        return AnimationController { inner: out };
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct AnimationController {
    inner: HashMap<u32, Vec<(TimelineNodeData, Option<Vec<TmfcData>>)>>,
}

#[wasm_bindgen]
impl AnimationController {
    pub fn animate(&self, sgb: &FFXIVSgb, instance_id: u32, dt: f32, model_matrix: &mut [f32]) {
        let obj = sgb.inner.sections.iter().flat_map(|s| &s.layer_groups).flat_map(|g| &g.layers).flat_map(|l| &l.objects).find(|o| o.instance_id == instance_id);
        if let Some(obj) = obj {
            let mut mm = convert_transform(obj.transform);
            if let Some(timelines) = self.inner.get(&instance_id) {
                for timeline in timelines {
                    match timeline {
                        (TimelineNodeData::C013(model_animation), Some(curves)) => {
                            for curve in curves {
                                let transform = curve_to_transform3d(curve, dt);
                                mm = mm.then(&transform);
                            }
                        }
                        _ => {}
                    }
                }

            }
            model_matrix.copy_from_slice(&mm.to_array())
        }
    }
}

fn curve_to_transform3d(curve: &TmfcData, at: f32) -> Transform3D<f32> {
    if curve.rows.len() == 0 {
        return Transform3D::identity();
    }
    if curve.rows.len() == 1 {
        return Transform3D::identity();
    }
    let start = curve.rows.iter().find(|x| x.time <= at).or(curve.rows.first()).unwrap();
    let end = curve.rows.iter().find(|x| x.time >= at).or(curve.rows.last()).unwrap();
    println!("{:?}, {:?}", start, end);
    let a = (at - start.time) / (end.time - start.time);

    let value = lerp_scalar(start.value, end.value, a);

    println!("a: {:?}, value: {:?}", a, value);

    match curve.attribute {
        Attribute::PositionX => Translation3D::new(value, 0f32, 0f32).to_transform(),
        Attribute::PositionY => Translation3D::new(0f32, value, 0f32).to_transform(),
        Attribute::PositionZ => Translation3D::new(0f32, 0f32, value).to_transform(),
        Attribute::RotationX => Rotation3D::around_x(Angle::degrees(value)).to_transform(),
        Attribute::RotationY => Rotation3D::around_y(Angle::degrees(value)).to_transform(),
        Attribute::RotationZ => Rotation3D::around_z(Angle::degrees(value)).to_transform(),
        Attribute::Unknown(_) => Transform3D::identity(),
    }
}

fn find_fcurve(nodes: &Vec<TimelineNode>, id: i32) -> Option<&Tmfc> {
    for node in nodes {
        match node {
            TimelineNode { data: TimelineNodeData::Tmfc(tmfc), .. } if tmfc.id == id as u16 => return Some(tmfc),
            _ => {}
        }
    }
    None
}

fn find_tmac(nodes: &Vec<TimelineNode>, id: i32) -> Option<&Tmac> {
    for node in nodes {
        match node {
            TimelineNode { data: TimelineNodeData::Tmac(data), .. } if data.time == id as u16 => return Some(data),
            _ => {}
        }
    }
    None
}

fn find_tmtr(nodes: &Vec<TimelineNode>, id: u16) -> Option<&Tmtr> {
    for node in nodes {
        match node {
            TimelineNode { data: TimelineNodeData::Tmtr(data), .. } if data.id == id => return Some(data),
            _ => {}
        }
    }
    None
}

fn find_node(nodes: &Vec<TimelineNode>, id: u16) -> Option<&TimelineNodeData> {
    for node in nodes {
        match node {
            TimelineNode { data: d@TimelineNodeData::Tmtr(data), .. } if data.id == id => return Some(d),
            TimelineNode { data: d@TimelineNodeData::Tmac(data), .. } if data.id == id => return Some(d),
            TimelineNode { data: d@TimelineNodeData::C013(data), .. } if data.id == id => return Some(d),
            _ => {}
        }
    }
    None
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
        // wrapper.animate();

        let mut file = File::create("/tmp/aether.tmb").unwrap();
        let mut writer = BufWriter::new(file);
        // let mut cursor = Cursor::new(&mut file);
        let tmb = &sgb.sections[0].timelines.timelines[0].tmb;
        // Tmb::write_options(tmb, &mut writer, Endian::Little, ()).unwrap();
        // writer.flush().unwrap();
        println!("Wait")
    }

    #[test]
    fn test_animation() {
        let path = PathBuf::from("/data/Projects/noclip.website/data/FFXIV/bgcommon/world/aet/shared/for_bg/sgbg_w_aet_001_01a.sgb");
        let sgb = Sgb::from_existing(Platform::Win32, &read(path.clone()).unwrap()).unwrap();
        let wrapper = FFXIVSgb::parse(read(path.clone()).unwrap());
        let mut mm = [0f32; 16];
        wrapper.animation_controller.animate(&wrapper, 9, 100f32, &mut mm);
    }
}
