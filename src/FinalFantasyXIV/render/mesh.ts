import { Color, OpaqueBlack, Red } from "../../Color";
import { GfxBuffer, GfxInputLayout } from "../../gfx/platform/GfxPlatformImpl";
import { GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxBufferUsage, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../../gfx/platform/GfxPlatform";
import { TextureMapping } from "../../TextureHolder";
import { MeshWrapper } from "../../../rust/pkg";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers";
import { getTriangleCountForTopologyIndexCount, GfxTopology } from "../../gfx/helpers/TopologyHelpers";
import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { DeviceProgram } from "../../Program";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary";
import { computeViewMatrix } from "../../Camera";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../../DebugJunk";
import { fillColor, fillMatrix4x3 } from "../../gfx/helpers/UniformBufferHelpers";
import * as Viewer from '../../viewer.js';
import { RenderGlobals } from "./globals";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache";

export class MeshProgram extends DeviceProgram {
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
};

layout(std140) uniform ub_ObjectParams {
    Mat3x4 u_ModelView;
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
layout(location = ${MeshProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${MeshProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${MeshProgram.a_TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${MeshProgram.a_TexCoord1}) attribute vec2 a_TexCoord1;


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
    if (t_DiffuseMapColor.a < .001) discard;
    vec3 t_NormalMap = texture(SAMPLER_2D(u_Texture2), v_TexCoord0.xy).xyz;
    vec3 t_LightDirection2 = normalize(vec3(.2, -1, .5));
    //t_NormalMap.z = 0.5;
    float eDotR = -dot(t_NormalMap, t_LightDirection2);
    //float eDotR = 0.5; // lighting workaround

    vec3 albedo = u_Color.a > 0.5 ? u_Color.xyz : t_DiffuseMapColor.rgb;
    gl_FragColor = vec4(albedo * (eDotR + 0.5), t_DiffuseMapColor.a);
}
#endif
`;

    public createLayout(renderCache: GfxRenderCache): GfxInputLayout {
        const vec3fSize = 3 * 4;
        const vec2fSize = 2 * 4;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        vertexAttributeDescriptors.push({
            location: MeshProgram.a_Position,
            bufferIndex: 0,
            bufferByteOffset: 0,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: MeshProgram.a_TexCoord0,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: MeshProgram.a_TexCoord1,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize + 1 * vec2fSize,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: MeshProgram.a_Normal,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize + 2 * vec2fSize,
            format: GfxFormat.F32_RGB
        });

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {byteStride: stride, frequency: GfxVertexBufferFrequency.PerVertex,},
        ];
        const indexBufferFormat: GfxFormat | null = GfxFormat.U16_R;
        const inputLayout = renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat
        });
        return inputLayout;
    }


    public bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {numUniformBuffers: 3, numSamplers: 6}, // ub_SceneParams
    ];
}

const stride = 23 * 4;

export class MeshRenderer {
    public name: string;
    public color: Color;

    public vertexBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    public drawCount: number;
    public triBuffer: GfxBuffer;
    public textureMappings: (TextureMapping | null)[] = [];

    public vertices: Uint8Array;

    constructor(public globals: RenderGlobals,
                public materialName: string,
                public mesh: MeshWrapper) {
        const material = globals.filesystem.materials.get(materialName);
        const textures = material?.texture_names.map(x => globals.filesystem.textures.get(x));
        this.textureMappings = textures?.map(t => {
            if (!t?.gfxTexture) return null;
            const mapping = new TextureMapping();
            mapping.gfxTexture = t.gfxTexture;
            mapping.gfxSampler = globals.repeatSampler;
            return mapping;
        }) ?? [];

        this.color = randomColorMap[materialName] ?? OpaqueBlack; // TODO this is because loading a festival messes the state up

        const vertices = this.vertices = mesh.attributes();
        this.vertexBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer)

        const triBytes = mesh.indices();
        this.drawCount = getTriangleCountForTopologyIndexCount(GfxTopology.Triangles, triBytes.length);
        this.triBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, triBytes.buffer);
        this.indexBufferDescriptor = {buffer: this.triBuffer};

        this.vertexBufferDescriptors = [
            {buffer: this.vertexBuffer},
        ];
    }

    public debugDrawVertices(viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4) {
        const view = new DataView(this.vertices.buffer);
        const mat = mat4.create();
        const vec = vec3.create();
        mat4.getTranslation(vec, modelMatrix);
        for (let i = 0; i < this.vertices.length; i += stride) {
            mat4.fromTranslation(mat, [view.getFloat32(i + 0, true), view.getFloat32(i + 4, true), view.getFloat32(i + 8, true)])
            mat4.mul(mat, modelMatrix, mat);
            mat4.getTranslation(vec, mat);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, Red, 2);
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, `${i}`, 0, OpaqueBlack, {font: "12pt monospace"})
        }
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4): void {
        const renderInstManager = this.globals.renderInstManager;
        const templateRenderInst = renderInstManager.getCurrentTemplate();

        computeViewMatrix(mat4scratch, viewerInput.camera);
        mat4.mul(mat4scratch, mat4scratch, modelMatrix);

        let offs = templateRenderInst.allocateUniformBuffer(MeshProgram.ub_ObjectParams, 4 + 16);
        const d = templateRenderInst.mapUniformBufferF32(MeshProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, mat4scratch);
        offs += fillColor(d, offs, this.color);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.globals.layout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.drawCount * 3);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(): void {
        const device = this.globals.renderHelper.device;
        device.destroyBuffer(this.vertexBuffer);
    }
}

export const randomColorMap: { [name: string]: Color } = {};
(window as any).randomColorMap = randomColorMap;

const mat4scratch = mat4.create();

