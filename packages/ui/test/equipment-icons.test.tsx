import { describe, expect, it } from 'vitest';
import * as I from '../src/icons/equipment';

describe('equipment silhouettes', () => {
  it.each([
    ['HD Projector (HDMI/VGA)', 'Audio & Video', I.ProjectorIcon],
    ['Dual Wireless HDMI Transmitter/Receiver Kit', 'Display Cables & Adapters', I.WirelessHdmiIcon],
    ['HDMI Cable 3 m', 'Display Cables & Adapters', I.HdmiCableIcon],
    ['HDMI Distributor / Splitter 1×4', 'Display Cables & Adapters', I.HdmiSplitterIcon],
    ['DVI-D Cable 1.8 m', 'Display Cables & Adapters', I.DviCableIcon],
    ['VGA to HDMI Adapter', 'Display Cables & Adapters', I.AdapterIcon],
    ['USB-C to HDMI Adapter', 'Display Cables & Adapters', I.AdapterIcon],
    ['Wireless Microphone (handheld)', 'Audio & Video', I.MicrophoneIcon],
    ['Bluetooth Speaker', 'Audio & Video', I.SpeakerIcon],
    ['Power Supply Cable (IEC C13)', 'Console & Power', I.PowerCableIcon],
    ['Extension Cable 5 m', 'Console & Power', I.ExtensionCableIcon],
    ['Power Distributor (8-way PDU)', 'Console & Power', I.PowerStripIcon],
    ['Ethernet Cable Cat6 10 m', 'Cables & Transceivers', I.PatchCableIcon],
    ['Cat6 Patch Cable 2 m', 'Cables & Transceivers', I.PatchCableIcon],
    ['SFP 1000BASE-SX Transceiver', 'Cables & Transceivers', I.SfpIcon],
    ['Cisco 2901 Router', 'Routers', I.RouterIcon],
    ['Catalyst 2960 48-port Switch', 'Switches', I.SwitchIcon],
    ['Aironet 2802i Access Point', 'Wireless', I.AccessPointIcon],
    ['UPS 1 kVA', 'Console & Power', I.UpsIcon],
    ['Lab Laptop (Packet Tracer)', 'Tools', I.LaptopIcon],
    ['RJ45 Crimping Tool', 'Tools', I.ToolIcon],
    ['HWIC-2T Serial Module', 'Modules & Cards', I.ModuleIcon],
  ])('%s → its own silhouette', (name, category, icon) => {
    expect(I.equipmentIconFor(name, category)).toBe(icon);
  });

  it('falls back to the category, then to the router silhouette', () => {
    expect(I.equipmentIconFor('Epson EB-X51', 'Projectors')).toBe(I.ProjectorIcon);
    expect(I.equipmentIconFor('Mystery box', null)).toBe(I.RouterIcon);
  });
});
