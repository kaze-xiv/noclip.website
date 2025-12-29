import { mat4, vec2, vec3 } from 'gl-matrix';

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
import { FFXIVMaterial, FFXIVModel, MeshWrapper } from "../../rust/pkg";
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

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;

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

uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;
uniform sampler2D u_Texture3;
uniform sampler2D u_Texture4;
uniform sampler2D u_Texture5;
uniform sampler2D u_Texture6;


#ifdef VERT
layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;


void mainVS() {
    const float t_ModelScale = 1.0;
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position * t_ModelScale, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    v_LightIntensity = -dot(a_Normal, t_LightDirection);

}
#endif

#ifdef FRAG
void mainPS() {
    float t_LightTint = 0.3 * v_LightIntensity;
    gl_FragColor = u_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);

}
#endif
`;
}

export class MeshRenderer {
    public name: string;
    public color: Color;

    public posBuffer: GfxBuffer;
    public triBuffer: GfxBuffer;
    public nrmBuffer: GfxBuffer;

    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public drawCount: number;
    public posData: Float32Array;
    public normalData: Float32Array;
    public modelMatrix: mat4 = mat4.create();

    public triBytes: Uint16Array;

    public mesh: MeshWrapper;

    public textureMappings: (TextureMapping | null)[] = [];

    constructor(public globals: RenderGlobals,
                public terrainModelRenderer: TerrainModelRenderer,
                public submeshIndex: number) {
        const mesh = this.mesh = terrainModelRenderer.meshes[submeshIndex];
        mat4.fromTranslation(this.modelMatrix, this.terrainModelRenderer.origin);

        const materialName = mesh.get_material();
        if (!materialMap[materialName]) {
            this.color = materialMap[materialName] = colorNewFromRGBA(Math.random(), Math.random(), Math.random());
        } else {
            this.color = materialMap[materialName];
        }
        const material = globals.filesystem[materialName] as FFXIVMaterial;
        const textures = material.get_texture_names().map(x => globals.filesystem[x] as Texture);
        const sampler = this.globals.renderHelper.renderCache.createSampler({
                    wrapS: GfxWrapMode.Clamp,
                    wrapT: GfxWrapMode.Clamp,
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

        // this.globals.rende

        const posData = this.posData = mesh.get_position_buffer_f32();
        const normalData = this.normalData = mesh.get_normal_buffer_f32();
        this.posBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, posData.buffer);
        this.nrmBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, normalData.buffer);
        this.triBytes = this.terrainModelRenderer.model.get_triangles(submeshIndex)
        this.drawCount = getTriangleCountForTopologyIndexCount(GfxTopology.Triangles, this.triBytes.length);
        this.triBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.triBytes.buffer);
        this.indexBufferDescriptor = {buffer: this.triBuffer};

        this.vertexBufferDescriptors = [
            {buffer: this.posBuffer},
            {buffer: this.nrmBuffer},
        ];
    }

    public debugDrawVertices(viewerInput: Viewer.ViewerRenderInput) {
        const vec = vec3.create();
        for (let i = 0; i < this.posData.length / 4; i++) {
            vec3.set(vec, this.posData[i * 4 + 0], this.posData[i * 4 + 1], this.posData[i * 4 + 2]);
            vec3.add(vec, vec, this.terrainModelRenderer.origin);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, this.color, 3);
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, `${i}`, 0, OpaqueBlack, {font: "12pt monospace"})
        }
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
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.nrmBuffer);
    }
}

const modelViewScratch = mat4.create();


const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    {numUniformBuffers: 2, numSamplers: 6}, // ub_SceneParams
];

const materialMap: { [name: string]: Color } = {};
(window as any).materialMap = materialMap;

export class TerrainModelRenderer {
    public meshRenderers: MeshRenderer[];
    public origin: vec3 = vec3.create();
    public modelMatrix: mat4 = mat4.create();
    public meshes: MeshWrapper[] = [];
    public model: FFXIVModel;

    constructor(public globals: RenderGlobals, public modelIndex: number) {
        const model = this.model = globals.terrain.models[modelIndex];
        this.meshes = model.meshes();
        this.meshRenderers = range(0, model.count_meshes()).map(i => new MeshRenderer(globals, this, i));
        const pos2D = vec2.create();
        this.globals.terrain.getPlatePosition(pos2D, this.modelIndex);
        vec3.set(this.origin, globals.terrain.plateSize * (pos2D[0] + 0.5), 0, globals.terrain.plateSize * (pos2D[1] + 0.5));
        mat4.fromTranslation(this.modelMatrix, this.origin);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
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
}

export class RenderGlobals {
    public meshProgram = new IVProgram();
    public meshGfxProgram: GfxProgram;
    public renderHelper: GfxRenderHelper;
    public renderInstManager: GfxRenderInstManager;
    public renderInstListMain = new GfxRenderInstList();
    public layout: GfxInputLayout;

    constructor(device: GfxDevice, public filesystem: FFXIVFilesystem, public terrain: Terrain) {
        this.renderHelper = new GfxRenderHelper(device);
        this.renderInstManager = this.renderHelper.renderInstManager;
        this.meshGfxProgram = this.renderHelper.renderCache.createProgram(this.meshProgram);
        this.layout = this.createLayout();
    }

    public createLayout(): GfxInputLayout {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {location: IVProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB,},
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {byteStride: 4 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex,},
            {byteStride: 4 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex,},
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
    private modelRenderers: TerrainModelRenderer[] = [];

    globals: RenderGlobals;

    public textureHolder: FakeTextureHolder;

    constructor(device: GfxDevice, terrain: Terrain, filesystem: FFXIVFilesystem) {
        this.globals = new RenderGlobals(device, filesystem, terrain)

        this.loadTextures();

        this.modelRenderers = range(0, terrain.plateCount).map(i => {
            return new TerrainModelRenderer(this.globals, i);
        });
    }

    private loadTextures() {
        const textures: Viewer.Texture[] = [];
        this.textureHolder = new FakeTextureHolder(textures);
        let yup = 0;
        this.globals.filesystem.textures.forEach(t => {
            t.converted = convertTexture(t);
            if (t.converted) {
                textures.push(textureToCanvas(t)!);
                t.gfxTexture = makeGraphicsTexture(this.globals.renderHelper.device, t.converted);
                if (t.gfxTexture != null) yup++
            }
        })
        console.log(`Yup count: ${yup}/${this.globals.filesystem.textures.length}`)
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
        this.modelRenderers.forEach((r) => r.destroy());
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