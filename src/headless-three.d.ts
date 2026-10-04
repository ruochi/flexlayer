declare module 'headless-three' {
  type HeadlessThree = {
    THREE: any
    render: (opts: Record<string, unknown>) => Promise<Buffer>
    loadTexture: (input: unknown) => Promise<any>
  }
  export default function getTHREE(opts: { Canvas: unknown; Image: unknown; ImageData: unknown }): Promise<HeadlessThree>
}
