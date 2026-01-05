import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec2 } from "gl-matrix";
import { FFXIVModel } from "../../rust/pkg";

export class Terrain {

    public plateSize: number;
    public plateCount: number;

    public models: FFXIVModel[];
    public modelNames: string[]

    constructor(private buffer: ArrayBufferSlice,) {
        const view = this.buffer.createDataView();
        this.plateCount = view.getUint32(4, true);
        this.plateSize = view.getUint32(8, true);
    }

    public getPlatePosition(out: vec2, index: number) {
        const view = this.buffer.createDataView(4 + 4 + 4 + 4 + 4 + 32);
        const structSize = 4;
        vec2.set(out, view.getInt16(index * structSize, true), view.getInt16(index * structSize + 2, true))
    }
}