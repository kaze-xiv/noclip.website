import { FFXIVLgb, FFXIVMaterial, FFXIVModel, FFXIVSgb } from "../../rust/pkg";
import { Terrain } from "./Terrain";
import { Texture } from "./Texture";

export class FFXIVFilesystem {
    public models = new Map<string, FFXIVModel>();
    public terrains: { [key: string]: Terrain | undefined } = {};
    public textures: { [key: string]: Texture | undefined } = {};
    public materials = new Map<string, FFXIVMaterial>();
    public lgbs: { [key: string]: FFXIVLgb | undefined } = {};
    public sgbs: { [key: string]: FFXIVSgb | undefined } = {};
}