use crate::ffxiv::layer::sgb::FFXIVSgb;
use crate::ffxiv::layer::util::convert_transform;
use euclid::default::{Rotation3D, Transform3D};
use euclid::Angle;
use nalgebra_glm::lerp_scalar;
use physis::sgb::Sgb;
use physis::tmb::{Attribute, TimelineNode, TimelineNodeData, Tmac, Tmfc, TmfcData, Tmtr};
use std::collections::HashMap;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct AnimationController {
    inner: HashMap<u32, Vec<(TimelineNodeData, Option<Vec<TmfcData>>)>>,
}

#[wasm_bindgen]
impl AnimationController {
    pub(crate) fn new(inner: &Sgb) -> Option<AnimationController> {
        let mut out: HashMap<u32, Vec<(TimelineNodeData, Option<Vec<TmfcData>>)>> = HashMap::new();
        for section in &inner.sections {
            for layer_group in &section.layer_groups {
                for layer in &layer_group.layers {
                    for object in &layer.objects {
                        let instance_id = object.instance_id;
                        for timeline in &section.timelines.timelines {
                            let mut animation_data: Vec<(TimelineNodeData, Option<Vec<TmfcData>>)> =
                                vec![];
                            let nodes = &timeline.tmb.nodes;
                            let macs: Vec<&Tmac> = timeline
                                .instances
                                .iter()
                                .filter_map(|instance| -> Option<&Tmac> {
                                    if instance.instance_id as u32 == instance_id {
                                        find_tmac(&timeline.tmb.nodes, instance.tmac_time)
                                    } else {
                                        None
                                    }
                                })
                                .collect();
                            let tmtr_ids = macs.iter().flat_map(|&mac| &mac.tmtr_ids);
                            let tmtrs =
                                tmtr_ids.filter_map(|&id| find_tmtr(&timeline.tmb.nodes, id));
                            let animation_ids = tmtrs.flat_map(|tmtr| &tmtr.animation_ids);
                            let animations: Vec<&TimelineNodeData> = animation_ids
                                .filter_map(|&id| find_node(nodes, id))
                                .collect();
                            for timeline_node in animations {
                                let my_fcurve = match timeline_node {
                                    TimelineNodeData::C013(model_animation) => {
                                        find_fcurve(nodes, model_animation.tmfc_id).map(|x| &x.data)
                                    }
                                    _ => None,
                                };
                                animation_data.push((
                                    (*timeline_node).clone(),
                                    my_fcurve.map(|x| (*x).clone()).clone(),
                                ));
                            }
                            if animation_data.len() > 0 {
                                out.entry(instance_id).insert_entry(animation_data);
                            }
                        }
                    }
                }
            }
        }
        if out.len() > 0 {
            Some(AnimationController { inner: out })
        } else {
            None
        }
    }

    pub fn animate(
        &self,
        sgb: &FFXIVSgb,
        instance_id: u32,
        dt: f32,
        model_matrix: &mut [f32],
    ) -> bool {
        let obj = sgb
            .inner
            .sections
            .iter()
            .flat_map(|s| &s.layer_groups)
            .flat_map(|g| &g.layers)
            .flat_map(|l| &l.objects)
            .find(|o| o.instance_id == instance_id);
        if let Some(obj) = obj {
            if let Some(timelines) = self.inner.get(&instance_id) {
                // log(format!("Rust found {:?}, {:?}", obj, timelines).as_str());
                let mut mm: Transform3D<f32> = Transform3D::identity();
                // let mut mm = convert_transform(obj.transform);

                for timeline in timelines {
                    match timeline {
                        (TimelineNodeData::C013(model_animation), Some(curves)) => {
                            let does_loop = model_animation.duration as f32;
                            for curve in curves {
                                let transform = curve_to_transform3d(curve, dt, Some(does_loop));
                                mm = mm.then(&transform);
                            }
                        }
                        _ => {}
                    }
                }
                mm = mm.then(&convert_transform(obj.transform));

                model_matrix.copy_from_slice(&mm.to_array());
                return true;
            }
        }
        false
    }
}

fn curve_to_transform3d(curve: &TmfcData, at: f32, loop_duration: Option<f32>) -> Transform3D<f32> {
    if curve.rows.len() == 0 {
        return Transform3D::identity();
    }
    if curve.rows.len() == 1 {
        return Transform3D::identity();
    }
    let looped_at = match loop_duration {
        Some(loop_duration) => at % loop_duration,
        None => at,
    };
    let start = curve
        .rows
        .iter()
        .find(|x| x.time <= looped_at)
        .or(curve.rows.first())
        .unwrap();
    let end = curve
        .rows
        .iter()
        .find(|x| x.time >= looped_at)
        .or(curve.rows.last())
        .unwrap();
    let a = (looped_at - start.time) / (end.time - start.time);

    let value = lerp_scalar(start.value, end.value, a);
    match curve.attribute {
        // Attribute::PositionX => Translation3D::new(value, 0f32, 0f32).to_transform(),
        // Attribute::PositionY => Translation3D::new(0f32, value, 0f32).to_transform(),
        // Attribute::PositionZ => Translation3D::new(0f32, 0f32, value).to_transform(),
        Attribute::RotationX => Rotation3D::around_x(Angle::degrees(value)).to_transform(),
        Attribute::RotationY => Rotation3D::around_y(Angle::degrees(value)).to_transform(),
        Attribute::RotationZ => Rotation3D::around_z(Angle::degrees(value)).to_transform(),
        _ => Transform3D::identity(),
    }
}

fn find_fcurve(nodes: &Vec<TimelineNode>, id: i32) -> Option<&Tmfc> {
    for node in nodes {
        match node {
            TimelineNode {
                data: TimelineNodeData::Tmfc(tmfc),
                ..
            } if tmfc.id == id as u16 => return Some(tmfc),
            _ => {}
        }
    }
    None
}

fn find_tmac(nodes: &Vec<TimelineNode>, id: i32) -> Option<&Tmac> {
    for node in nodes {
        match node {
            TimelineNode {
                data: TimelineNodeData::Tmac(data),
                ..
            } if data.time == id as u16 => return Some(data),
            _ => {}
        }
    }
    None
}

fn find_tmtr(nodes: &Vec<TimelineNode>, id: u16) -> Option<&Tmtr> {
    for node in nodes {
        match node {
            TimelineNode {
                data: TimelineNodeData::Tmtr(data),
                ..
            } if data.id == id => return Some(data),
            _ => {}
        }
    }
    None
}

fn find_node(nodes: &Vec<TimelineNode>, id: u16) -> Option<&TimelineNodeData> {
    for node in nodes {
        match node {
            TimelineNode {
                data: d @ TimelineNodeData::Tmtr(data),
                ..
            } if data.id == id => return Some(d),
            TimelineNode {
                data: d @ TimelineNodeData::Tmac(data),
                ..
            } if data.id == id => return Some(d),
            TimelineNode {
                data: d @ TimelineNodeData::C013(data),
                ..
            } if data.id == id => return Some(d),
            _ => {}
        }
    }
    None
}
