import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WebgpuHelp } from './webgpu-help';

@Component({
  imports: [WebgpuHelp],
  template: `<app-webgpu-help chain="testnet" [autoOpen]="autoOpen()" />`,
})
class Host {
  readonly autoOpen = signal(false);
}

function dialogOpen(fixture: ComponentFixture<Host>): boolean {
  const dlg = fixture.nativeElement.querySelector('#testnet-webgpuHelpDialog') as HTMLDialogElement | null;
  expect(dlg).toBeTruthy();
  return !!(dlg?.open || dlg?.hasAttribute('open'));
}

describe('WebgpuHelp', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('opens the enable dialog from Help', () => {
    expect(dialogOpen(fixture)).toBe(false);
    const help = fixture.nativeElement.querySelector('#testnet-webgpuHelp') as HTMLButtonElement;
    help.click();
    fixture.detectChanges();
    expect(dialogOpen(fixture)).toBe(true);
    const text = fixture.nativeElement.querySelector('#testnet-webgpuHelpDialog')?.textContent ?? '';
    expect(text).toMatch(/chrome:\/\/gpu/);
    expect(text).toMatch(/ignore-gpu-blocklist/);
    expect(text).toMatch(/--disable-gpu/);
  });

  it('auto-opens once when autoOpen becomes true', () => {
    expect(dialogOpen(fixture)).toBe(false);
    fixture.componentInstance.autoOpen.set(true);
    fixture.detectChanges();
    expect(dialogOpen(fixture)).toBe(true);
    fixture.nativeElement.querySelector('#testnet-webgpuHelpClose')?.click();
    fixture.detectChanges();
    expect(dialogOpen(fixture)).toBe(false);
    fixture.detectChanges();
    expect(dialogOpen(fixture)).toBe(false);
  });
});
