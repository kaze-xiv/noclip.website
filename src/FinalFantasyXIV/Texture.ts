import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec2 } from "gl-matrix";
import { GfxDevice, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { XNA_SurfaceFormat, XNA_Texture2D } from "../Fez/XNB";
import { GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { assert } from "../util";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { DecodedSurfaceBC, DecodedSurfaceSW, decompressBC } from "../Common/bc_texture";
import * as Viewer from "../viewer.js";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import { FFXIVTexture } from "../../rust/pkg";

export class Texture {
    public attributes: number;
    public format: number;
    public width: number;
    public height: number;
    public depth: number;
    public mipLevels: number;
    public arraySize: number;
    public lodOffsets: number[];
    public data: ArrayBufferSlice;

    public gfxTexture: GfxTexture | null = null;
    public canvas: HTMLCanvasElement | null = null;

    constructor(public buffer: ArrayBufferSlice, public path: string) {
        const view = this.buffer.createDataView();
        this.attributes = view.getUint32(0, true);
        this.format = view.getUint32(4, true);
        this.width = view.getUint16(8, true);
        this.height = view.getUint16(10, true);
        this.depth = view.getUint16(12, true);
        this.mipLevels = view.getUint16(14, true);
        this.arraySize = view.getUint16(16, true);
        this.data = this.buffer.slice(82);
    }

    useSwConversion: boolean = false;
    createGfxTexture(device: GfxDevice): GfxTexture | null {
        if (this.format == TextureFormat.BC1) {
            return this.gfxTexture = this.createGfxTextureThroughSwConversion(device);
        } else {
            return this.gfxTexture = this.createGfxTextureThroughRustDecode(device);
        }
        // if (this.useSwConversion) {
        //     return this.gfxTexture = this.createGfxTextureThroughSwConversion(device);
        // } else {
        //     return this.gfxTexture = this.createGfxTextureThroughDirectUpload(device);
        // }
        return null;
    }

    createGfxTextureThroughSwConversion(device: GfxDevice): GfxTexture | null {
        if (this.format != TextureFormat.BC1) return null;
        const x: DecodedSurfaceBC = {
            width: this.width,
            height: this.height,
            depth: this.depth,
            flag: "SRGB", // ??
            type: "BC1",
            pixels: new Uint8Array(this.data.arrayBuffer as any as ArrayBuffer) // idk dude
        }
        const pixels = decompressBC(x);

        this.canvas = convertToCanvas(ArrayBufferSlice.fromView(pixels.pixels), this.width, this.height);

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, 1));
        device.uploadTextureData(gfxTexture, 0, [pixels.pixels]);
        return gfxTexture;
    }

    createGfxTextureThroughDirectUpload(device: GfxDevice): GfxTexture | null {
        if (this.format != TextureFormat.BC1) return null;

        console.log("Attempt to direct upload", this);
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.BC1_SRGB, this.width, this.height, this.mipLevels));
        device.uploadTextureData(gfxTexture, 0, [this.buffer.createDataView(80)]);
        return gfxTexture;
    }

    createGfxTextureThroughRustDecode(device: GfxDevice): GfxTexture | null {
        const decode = FFXIVTexture.decode_bc7(this.buffer.createTypedArray(Uint8Array));

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, this.mipLevels));
        device.uploadTextureData(gfxTexture, 0, [decode]);

        this.canvas = convertToCanvas(ArrayBufferSlice.fromView(decode), this.width, this.height);
        return gfxTexture;
    }
}


// https://github.com/NotAdam/Lumina/blob/12d0e8d418d8dc49f04e6bee1d06bae2905232c6/src/Lumina/Data/Files/TexFile.cs#L74
export enum TextureFormat {
    TypeShift = 0xC,
    TypeMask = 0xF000,
    ComponentShift = 0x8,
    ComponentMask = 0xF00,
    BppShift = 0x4,
    BppMask = 0xF0,
    EnumShift = 0x0,
    EnumMask = 0xF,
    TypeInteger = 0x1,
    TypeFloat = 0x2,
    TypeDxt = 0x3,
    TypeBc123 = 0x3,
    TypeDepthStencil = 0x4,
    TypeSpecial = 0x5,
    TypeBc57 = 0x6,

    Unknown = 0x0,

    // Integer types
    L8 = 0x1130,
    A8 = 0x1131,
    B4G4R4A4 = 0x1440,
    B5G5R5A1 = 0x1441,
    B8G8R8A8 = 0x1450,
    B8G8R8X8 = 0x1451,

    // [Obsolete( "Use B4G4R4A4 instead." )]
    R4G4B4A4 = 0x1440,

    // [Obsolete( "Use B5G5R5A1 instead." )]
    R5G5B5A1 = 0x1441,

    // [Obsolete( "Use B8G8R8A8 instead." )]
    A8R8G8B8 = 0x1450,

    // [Obsolete( "Use B8G8R8X8 instead." )]
    R8G8B8X8 = 0x1451,

    // [Obsolete( "Not supported by Windows DirectX 11 version of the game, nor have any mention of the value, as of 6.15." )]
    A8R8G8B82 = 0x1452,

    // Floating point types
    R32F = 0x2150,
    R16G16F = 0x2250,
    R32G32F = 0x2260,
    R16G16B16A16F = 0x2460,
    R32G32B32A32F = 0x2470,

    // Block compression types (DX9 names)
    DXT1 = 0x3420,
    DXT3 = 0x3430,
    DXT5 = 0x3431,
    ATI2 = 0x6230,

    // Block compression types (DX11 names)
    BC1 = 0x3420,
    BC2 = 0x3430,
    BC3 = 0x3431,
    BC4 = 0x6120,
    BC5 = 0x6230,
    BC6H = 0x6330,
    BC7 = 0x6432,

    // Depth stencil types
    // Does not exist in ffxiv_dx11.exe: RGBA8 0x4401
    D16 = 0x4140,
    D24S8 = 0x4250,

    // Special types
    Null = 0x5100,
    Shadow16 = 0x5140,
    Shadow24 = 0x5150,
}
