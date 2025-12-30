import { rust } from "../rustlib";
import { FlatLayoutObject, shimFlatLayoutObject } from "./FlatLayoutObject";

export interface SgbFile extends rust.FFXIVSgb {

}

export function shimSgb(file: rust.FFXIVSgb): SgbFile {
    const out = {
        discoveredModels: file.discoveredModels, discoveredSgbs: file.discoveredSgbs, objects: file.objects.map(shimFlatLayoutObject),
        free: null as any,
    }
    return out;
}

export function shimLgb(file: rust.FFXIVLgb): rust.FFXIVLgb {
    const out = {
        discoveredModels: file.discoveredModels, discoveredSgbs: file.discoveredSgbs, objects: file.objects.map(shimFlatLayoutObject),
        free: null as any,
    }
    return out;
}