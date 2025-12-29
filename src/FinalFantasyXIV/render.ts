import { mat4, quat, vec2, vec3, vec4 } from 'gl-matrix';

import { DeviceProgram } from '../Program.js';
import * as Viewer from '../viewer.js';

import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { CameraController, computeViewMatrix } from '../Camera.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { FFXIVLgb, FFXIVMaterial, FFXIVModel, FlatLayoutObject, MeshWrapper } from "../../rust/pkg";
import { Color, colorNewFromRGBA } from "../Color";
import { getTriangleCountForTopologyIndexCount, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { Terrain } from "./Terrain";
import { range } from "../MathHelpers";
import { FFXIVFilesystem } from "./scenes";
import { FakeTextureHolder, TextureMapping } from "../TextureHolder";
import { convertTexture, makeGraphicsTexture, Texture } from "./Texture";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { TextureListHolder } from "../ui";

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_ModelView;
};

layout(std140) uniform ub_ObjectParams {
    vec4 u_Color;
};

varying float v_LightIntensity;
varying vec2 v_TexCoord0;
varying vec2 v_TexCoord1;

uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;
uniform sampler2D u_Texture3;
uniform sampler2D u_Texture4;
uniform sampler2D u_Texture5;
uniform sampler2D u_Texture6;


#ifdef VERT
layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${IVProgram.a_TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${IVProgram.a_TexCoord1}) attribute vec2 a_TexCoord1;


void mainVS() {
    const float t_ModelScale = 1.0;
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position * t_ModelScale, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    v_LightIntensity = -dot(a_Normal, t_LightDirection);
    v_TexCoord0 = a_TexCoord0;
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_DiffuseMapColor = texture(SAMPLER_2D(u_Texture1), v_TexCoord0.xy);
    
    gl_FragColor.rgb = u_Color.a > 0.5 ? u_Color.xyz : t_DiffuseMapColor.rgb;

    //float t_LightTint = 0.3 * v_LightIntensity;
    //gl_FragColor = u_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);
}
#endif
`;
}

const stride = 23 * 4;

export class MeshRenderer {
    public name: string;
    public color: Color;

    public vertices: Uint8Array;
    public vertexBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    public drawCount: number;

    public triBytes: Uint16Array;
    public triBuffer: GfxBuffer;


    public textureMappings: (TextureMapping | null)[] = [];


    constructor(public globals: RenderGlobals,
                public materialName: string,
                public mesh: MeshWrapper,
                public modelMatrix: mat4) {
        const material = globals.filesystem[materialName] as FFXIVMaterial;
        const textures = material.get_texture_names().map(x => globals.filesystem[x] as Texture);
        const sampler = this.globals.renderHelper.renderCache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });
        this.textureMappings = textures.map(t => {
            if (t.gfxTexture == null) return null;
            const mapping = new TextureMapping();
            mapping.gfxTexture = t.gfxTexture;
            mapping.gfxSampler = sampler;
            return mapping;
        })

        if (!randomColorMap[textures[0].path]) {
            if (!textures[0].gfxTexture) {
                this.color = randomColorMap[materialName] = colorNewFromRGBA(Math.random(), Math.random(), Math.random(), 0.9);
            } else {
                this.color = randomColorMap[materialName] = colorNewFromRGBA(Math.random(), Math.random(), Math.random(), 0.0);
            }
        } else {
            this.color = randomColorMap[materialName];
        }

        const vertices = this.vertices = mesh.attributes();
        this.vertexBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer)


        this.triBytes = mesh.indices()
        this.drawCount = getTriangleCountForTopologyIndexCount(GfxTopology.Triangles, this.triBytes.length);
        this.triBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.triBytes.buffer);
        this.indexBufferDescriptor = {buffer: this.triBuffer};

        this.vertexBufferDescriptors = [
            {buffer: this.vertexBuffer},
        ];
    }

    public debugDrawVertices(viewerInput: Viewer.ViewerRenderInput) {
        // const view = new DataView(this.vertices.buffer);
        // const vec = vec3.create();
        // for (let i = 0; i < this.vertices.length / stride; i++) {
        //     const start = stride * i;
        //     vec3.set(vec, view.getFloat32(start + 0), view.getFloat32(start + 4), view.getFloat32(start + 8));
        //     vec3.add(vec, vec, this.terrainModelRenderer.origin);
        //     drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, this.color, 3);
        //     // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, `${i}`, 0, OpaqueBlack, {font: "12pt monospace"})
        // }
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.globals.renderInstManager;
        // this.debugDrawVertices(viewerInput);

        const templateRenderInst = renderInstManager.pushTemplate();

        let offs = templateRenderInst.allocateUniformBuffer(IVProgram.ub_ObjectParams, 4);

        const d = templateRenderInst.mapUniformBufferF32(IVProgram.ub_ObjectParams);
        offs += fillColor(d, offs, this.color);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.globals.layout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.drawCount * 3);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    public destroy(): void {
        const device = this.globals.renderHelper.device;
        device.destroyBuffer(this.vertexBuffer);
    }
}

const modelViewScratch = mat4.create();


const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    {numUniformBuffers: 3, numSamplers: 6}, // ub_SceneParams
];

const randomColorMap: { [name: string]: Color } = {};
(window as any).randomColorMap = randomColorMap;

const vec3scratch = vec3.create();
const vec2scratch = vec2.create();
const vec4scratch = vec4.create();

export class TerrainModelRenderer {
    public meshRenderers: MeshRenderer[] = [];
    public meshes: MeshWrapper[] = [];
    public modelMatrix: mat4 = mat4.create();

    constructor(public globals: RenderGlobals, public model: FFXIVModel, public modelIndex: number) {
        this.meshes = model.meshes;
        const materials = model.materials;

        this.calculateModelMatrix();

        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            this.meshRenderers.push(new MeshRenderer(globals, materials[mesh.get_material_index()], mesh, this.modelMatrix))
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        // TODO is this supposed to be here?
        const template = renderInstManager.getCurrentTemplate();
        let offs = template.allocateUniformBuffer(IVProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(IVProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(mapped, offs, modelViewScratch);

        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(viewerInput);
    }

    destroy() {
        this.meshRenderers.forEach((r) => r.destroy());
    }

    calculateModelMatrix() {
        const terrain = this.globals.terrain;
        terrain.getPlatePosition(vec2scratch, this.modelIndex);
        vec3.set(vec3scratch, terrain.plateSize * (vec2scratch[0] + 0.5), 0, terrain.plateSize * (vec2scratch[1] + 0.5));
        mat4.fromTranslation(this.modelMatrix, vec3scratch);
    }
}

type LayoutObjectRenderer = BgLayerObjectRenderer | null;


export class BgLayerObjectRenderer {

    public meshRenderers: MeshRenderer[] = [];
    public meshes: MeshWrapper[] = [];
    public modelMatrix: mat4 = mat4.create();

    constructor(public globals: RenderGlobals, public obj: FlatLayoutObject, public model: FFXIVModel, public modelIndex: number) {
        this.meshes = this.model.meshes;
        const materials = this.model.materials;

        this.calculateModelMatrix();

        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            this.meshRenderers.push(new MeshRenderer(globals, materials[mesh.get_material_index()], mesh, this.modelMatrix))
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        // TODO is this supposed to be here?
        const template = renderInstManager.getCurrentTemplate();
        let offs = template.allocateUniformBuffer(IVProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(IVProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(mapped, offs, modelViewScratch);

        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(viewerInput);
    }

    calculateModelMatrix() {
        // debugger;
        quat.fromEuler(vec4scratch, this.obj.rotation[0] / Math.PI * 180, this.obj.rotation[1] / Math.PI * 180, this.obj.rotation[2] / Math.PI * 180);
        mat4.fromRotationTranslationScale(this.modelMatrix, vec4scratch, this.obj.translation, this.obj.scale);
    }

    public destroy() {

    }
}

export class LgbRenderer {
    public modelMatrix: mat4 = mat4.create();
    public objectRenderers: (LayoutObjectRenderer | null)[] = [];

    constructor(public globals: RenderGlobals, public lgb: FFXIVLgb, public lgbIndex: number) {
        const objs = lgb.objects;
        for (let i = 0; i < objs.length; i++) {
            if (i > 20000) break;
            const obj = objs[i];
            if (obj.layer_type == 0x01) {
                const mdlLookup = globals.filesystem[obj.asset_name!] as (FFXIVModel | null);
                if (mdlLookup) {
                    this.objectRenderers.push(new BgLayerObjectRenderer(globals, obj, mdlLookup, i));
                }
            } else {
                this.objectRenderers.push(null);
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        // const template = renderInstManager.getCurrentTemplate();
        // let offs = template.allocateUniformBuffer(IVProgram.ub_SceneParams, 32);
        // const mapped = template.mapUniformBufferF32(IVProgram.ub_SceneParams);
        // offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        // computeViewMatrix(modelViewScratch, viewerInput.camera);
        // mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        // offs += fillMatrix4x3(mapped, offs, modelViewScratch);

        for (let i = 0; i < this.objectRenderers.length; i++) {
            const renderer = this.objectRenderers[i]
            if (renderer)
                renderer.prepareToRender(renderInstManager, viewerInput);
        }
    }

    destroy() {
        this.objectRenderers.forEach((r) => r?.destroy());
    }
}

export class RenderGlobals {
    public meshProgram = new IVProgram();
    public meshGfxProgram: GfxProgram;
    public renderHelper: GfxRenderHelper;
    public renderInstManager: GfxRenderInstManager;
    public renderInstListMain = new GfxRenderInstList();
    public layout: GfxInputLayout;

    constructor(device: GfxDevice, public filesystem: FFXIVFilesystem, public terrain: Terrain, public lgbs: FFXIVLgb[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.renderInstManager = this.renderHelper.renderInstManager;
        this.meshGfxProgram = this.renderHelper.renderCache.createProgram(this.meshProgram);
        this.layout = this.createLayout();
    }

    public createLayout(): GfxInputLayout {
        const vec3fSize = 3 * 4;
        const vec2fSize = 2 * 4;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        vertexAttributeDescriptors.push({
            location: IVProgram.a_Position,
            bufferIndex: 0,
            bufferByteOffset: 0,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: IVProgram.a_TexCoord0,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: IVProgram.a_TexCoord1,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize + 1 * vec2fSize,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: IVProgram.a_Normal,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize + 2 * vec2fSize,
            format: GfxFormat.F32_RGB
        });

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {byteStride: stride, frequency: GfxVertexBufferFrequency.PerVertex,},
        ];
        const indexBufferFormat: GfxFormat | null = GfxFormat.U16_R;
        const cache = this.renderHelper.renderCache;
        const inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat
        });
        return inputLayout;
    }

    public destroy() {
        this.renderHelper.destroy();
    }
}

export class FFXIVRenderer implements Viewer.SceneGfx {
    private modelRenderers: (TerrainModelRenderer | null)[] = [];
    private lgbRenderers: (LgbRenderer | null)[] = [];

    globals: RenderGlobals;

    public textureHolder: TextureListHolder;

    constructor(device: GfxDevice, terrain: Terrain, filesystem: FFXIVFilesystem, lgbs: FFXIVLgb[]) {
        this.globals = new RenderGlobals(device, filesystem, terrain, lgbs)

        this.modelRenderers = range(0, terrain.plateCount).map(i => {
            const model = this.globals.terrain.models[i];
            if (!model) return null;
            return new TerrainModelRenderer(this.globals, model, i);
        });

        for (let i = 0; i < lgbs.length; i++)
            this.lgbRenderers.push(new LgbRenderer(this.globals, lgbs[i], i));
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 60);
    }

    private prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        const renderHelper = this.globals.renderHelper;

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.globals.meshGfxProgram);
        template.setMegaStateFlags({cullMode: GfxCullMode.Back});

        renderHelper.renderInstManager.setCurrentList(this.globals.renderInstListMain);

        for (let i = 0; i < this.modelRenderers.length; i++)
            this.modelRenderers[i]!.prepareToRender(renderHelper.renderInstManager, viewerInput);

        for (let i = 0; i < this.lgbRenderers.length; i++)
            this.lgbRenderers[i]!.prepareToRender(renderHelper.renderInstManager, viewerInput);


        renderHelper.renderInstManager.popTemplate();
        renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderHelper = this.globals.renderHelper;
        const renderInstListMain = this.globals.renderInstListMain;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstListMain.drawOnPassRenderer(renderHelper.renderCache, passRenderer);
            });
        });
        renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(viewerInput);
        renderHelper.renderGraph.execute(builder);
        renderInstListMain.reset();
    }

    public destroy(): void {
        this.modelRenderers.forEach((r) => r?.destroy());
        this.globals.destroy();
    }
}

function textureToCanvas(texture: Texture): Viewer.Texture | null {
    const converted = texture.converted;
    if (!converted) return null;
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(converted.pixels), texture.width, texture.height);
    canvas.title = texture.path;

    const surfaces = [canvas];
    const extraInfo = new Map<string, string>();
    // extraInfo.set('Format', "IDK");
    return { name: texture.path, surfaces, extraInfo };
}

export function processTextures(device: GfxDevice, textures: Texture[]): FakeTextureHolder {
    const vTextures: Viewer.Texture[] = [];
    const fth = new FakeTextureHolder(vTextures);

    textures.forEach(t => {
        t.converted = convertTexture(t);
        if (t.converted) {
            vTextures.push(textureToCanvas(t)!);
            fth.textureNames.push(t.path);
            t.gfxTexture = makeGraphicsTexture(device, t.converted);
            if (t.gfxTexture == null) {
                console.log(`Failed to make texture for ${t.format}`)
            }
        } else {
            console.log(`Failed to make texture for ${t.format}`)
        }
    })
    return fth;
}