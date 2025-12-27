import { FFXIVLgb, FFXIVMaterial, FFXIVModel, FFXIVSgb } from "../../../rust/pkg";
import { Terrain } from "./Terrain";
import { Texture } from "./Texture";
import { DataFetcher, NamedArrayBufferSlice } from "../../DataFetcher";
import { SgbFile, shimLgb, shimSgb } from "./layer";

export const pathBase = "FFXIV";

export class FFXIVFilesystem {
    public terrain: Terrain | null;
    public models = new Map<string, FFXIVModel>();
    public textures = new Map<string, Texture>();
    public materials = new Map<string, FFXIVMaterial>();
    public lgbs = new Map<string, FFXIVLgb>();
    public sgbs = new Map<string, SgbFile>();

    public queue = new Map<string, Promise<any>>();

    constructor(public dataFetcher: DataFetcher) {
    }

    public async queueDownloadAndParse<T>(path: string, parser: (buffer: NamedArrayBufferSlice) => T, allow404: boolean = false): Promise<T> {
        const exists = this.queue.get(path);
        if (exists) return exists;
        const promise = this.dataFetcher.fetchData(path, {allow404: allow404}).then(parser);
        this.queue.set(path, promise);
        return await promise;
    }

    public async loadLgb(path: string): Promise<FFXIVLgb> {
        return await this.queueDownloadAndParse(`${pathBase}/${path}`, (data) => {
            const lgb = shimLgb(FFXIVLgb.parse(data.createTypedArray(Uint8Array)));
            this.lgbs.set(path, lgb);
            return lgb;
        });
    }

    async loadSgb(path: string): Promise<SgbFile> {
        const attempt = this.sgbs.get(path);
        if (attempt) return attempt;
        return await this.queueDownloadAndParse(`${pathBase}/${path}`, (data) => {
            const sgb = shimSgb(FFXIVSgb.parse(data.createTypedArray(Uint8Array)));
            this.sgbs.set(path, sgb);
            return sgb;
        });
    }

    public async loadPart(path: string): Promise<FFXIVModel | null> {
        try {
            const exists = this.models.get(path)
            if (exists) return exists;
            return await this.queueDownloadAndParse(`${pathBase}/${path}`, (data) => {
                const parsed = FFXIVModel.parse(data.createTypedArray(Uint8Array));
                if (!parsed) return null; // ???
                this.models.set(path, parsed);
                return parsed;
            });
        } catch {
            console.error(`Failed to load ${path}`);
            return null;
        }
    }

    public async loadMaterial(path: string): Promise<FFXIVMaterial> {
        const attempt = this.materials.get(path);
        if (attempt) return attempt;
        return await this.queueDownloadAndParse(`${pathBase}/${path}`, (data) => {
            const parsed = FFXIVMaterial.parse(data.createTypedArray(Uint8Array));
            // i'm paranoid about getter_with_clone now
            const shimMat = {
                texture_names: parsed.texture_names,
                shader_name: parsed.shader_name,
            } as FFXIVMaterial;
            this.materials.set(path, shimMat);
            return shimMat;
        });
    }

    public async loadTexture(path: string): Promise<Texture> {
        const attempt = this.textures.get(path);
        if (attempt) return attempt;
        return await this.queueDownloadAndParse(`${pathBase}/${path}`, (data) => {
            const parsed = new Texture(data, path);
            this.textures.set(path, parsed);
            return parsed;
        });
    }
}