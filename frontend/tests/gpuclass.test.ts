/**
 * THE WEAK GPU (src/rendering/quality/DeviceProfile.ts weakRenderer): real renderer strings as Chrome reports them —
 * the Chromebooks' and cheap laptops' chips drawn the phones' way (quality.ts), every other GPU as a PC.
 */
import { strongPhoneGpu, weakRenderer } from '../src/rendering/quality/DeviceProfile'

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
// A HIGH-END PHONE's GPU (strongPhoneGpu — the rain's drops on the car, oth/Drops.ts): the flagships' chips; the
// 6-series Snapdragons', the Mali-G5x / G6x, PowerVR and a name it cannot read are not
const phone = (r: string, strong: boolean) => {
  const ok = strongPhoneGpu(r) === strong
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${strong ? 'high-end phone' : 'not'}  ${r}`)
  if (!ok) failures++
}
phone('Apple GPU', true)
phone('ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)', true)
phone('Adreno (TM) 740', true)
phone('Adreno (TM) 730', true)
phone('Adreno (TM) 660', true)
phone('Mali-G715-Immortalis MC11', true)
phone('ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)', true)
phone('Mali-G78 MP14', true)
phone('ANGLE (Samsung Electronics Co., Ltd., Samsung Xclipse 940, OpenGL ES 3.2)', true)
phone('ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)', false)
phone('Adreno (TM) 610', false)
phone('Adreno (TM) 710', false)
phone('Mali-G57 MC2', false)
phone('Mali-G610 MC4', false)
phone('Mali-G68 MC4', false)
phone('PowerVR Rogue GE8320', false)
phone('', false)
if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
