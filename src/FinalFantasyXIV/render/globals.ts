import { GfxInputLayout, GfxProgram, GfxSampler } from "../../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";
import { GfxRenderInstList, GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import { MeshProgram } from "./mesh";
import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../../gfx/platform/GfxPlatform";
import { FFXIVFilesystem } from "../files/Filesystem";
import { ModelRenderer } from "./model";

export class RenderGlobals {
    public meshProgram = new MeshProgram();
    public meshGfxProgram: GfxProgram;
    public renderHelper: GfxRenderHelper;
    public renderInstManager: GfxRenderInstManager;
    public renderInstListMain = new GfxRenderInstList();
    public layout: GfxInputLayout;
    public repeatSampler: GfxSampler;

    public modelCache: { [key: string]: ModelRenderer } = {};
    public festivals = new Set<number>();

    constructor(device: GfxDevice, public filesystem: FFXIVFilesystem) {
        this.renderHelper = new GfxRenderHelper(device);
        this.renderInstManager = this.renderHelper.renderInstManager;
        this.meshGfxProgram = this.renderHelper.renderCache.createProgram(this.meshProgram);
        this.layout = this.meshProgram.createLayout(this.renderHelper.renderCache);
        this.repeatSampler = this.renderHelper.renderCache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy() {
        this.renderHelper.destroy();
    }
}