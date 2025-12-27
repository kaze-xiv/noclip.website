use euclid::default::{Rotation3D, Transform3D, Vector3D};
use euclid::Angle;
use physis::layer::Transformation;

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