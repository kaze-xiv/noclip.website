import { rust } from "../../rustlib";
import { LayerWrapped } from "../../../rust/pkg";

export interface SgbFile {
    layers: LayerWrapped[];
    animation_controller: rust.AnimationController | undefined;
    inner: rust.FFXIVSgb;
}

export function shimSgb(file: rust.FFXIVSgb): SgbFile {
    return {
        inner: file,
        animation_controller: file.animation_controller,
        layers: file.layers(),
    };
}

export function shimLgb(file: rust.FFXIVLgb): rust.FFXIVLgb {
    return {
        layers: file.layers,
        find_festivals: () => file.find_festivals(),
        free: null as any,
    }
}