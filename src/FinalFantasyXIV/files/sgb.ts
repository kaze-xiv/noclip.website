import { rust } from "../../rustlib";
import { FlatLayoutObject, shimFlatLayoutObject } from "./FlatLayoutObject";

export interface SgbFile {
    objects: FlatLayoutObject[];
    animation_controller: rust.AnimationController | undefined;
    inner: rust.FFXIVSgb;
}

export function shimSgb(file: rust.FFXIVSgb): SgbFile {
    const out = {
        objects: file.flatten_objects().map(shimFlatLayoutObject),
        animation_controller: file.animation_controller ?? undefined,
        inner: file,
    }
    return out;
}

export function shimLgb(file: rust.FFXIVLgb): rust.FFXIVLgb {
    const out = {
        objects: file.objects.map(shimFlatLayoutObject),
        free: null as any,
    }
    return out;
}