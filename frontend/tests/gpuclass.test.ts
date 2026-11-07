/**
 * THE WEAK GPU (src/rendering/quality/DeviceProfile.ts weakRenderer): real renderer strings as Chrome reports them —
 * the Chromebooks' and cheap laptops' chips drawn the phones' way (quality.ts), every other GPU as a PC.
 */
import { weakRenderer } from '../src/rendering/quality/DeviceProfile'

let failures = 0
const check = (r: string, weak: boolean) => {
  const ok = weakRenderer(r) === weak
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${weak ? 'weak' : 'full'}  ${r}`)
  if (!ok) failures++
}
// weak: Intel HD / UHD / Iris Plus, the ARM Chromebooks, software
check('ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL ES 3.2)', true)
check('ANGLE (Intel, Mesa Intel(R) UHD Graphics (JSL), OpenGL ES 3.2)', true)
check('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', true)
check('ANGLE (Intel, Intel(R) HD Graphics 500 Direct3D11 vs_5_0 ps_5_0, D3D11)', true)
check('ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)', true)
check('ANGLE (ARM, Mali-G72, OpenGL ES 3.2)', true)
check('ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)', true)
check('ANGLE (Imagination Technologies, PowerVR Rogue GX6250, OpenGL ES 3.2)', true)
check('ANGLE (Qualcomm, Adreno (TM) 618, OpenGL ES 3.2)', true)
check('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', true)
check('llvmpipe (LLVM 15.0.7, 256 bits)', true)
// full: discrete, Apple, Iris Xe, Arc, Radeon integrated, Snapdragon X, unknown
check('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)', false)
check('ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028A1) Direct3D11 vs_5_0 ps_5_0, D3D11)', false)
check('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', false)
check('ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)', false)
check('ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', false)
check('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)', false)
check('ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', false)
check('', false)
if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
