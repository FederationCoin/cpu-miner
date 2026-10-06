import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DocsPane } from './docs-pane';
import { MINER_SHELL, desktopShell } from './miner-shell';

@Component({
  imports: [DocsPane],
  template: `<app-docs-pane chain="testnet" />`,
})
class Host {}

describe('DocsPane subsidy section', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: MINER_SHELL, useValue: desktopShell() }],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('explains the fee after the subsidy', () => {
    const text = fixture.debugElement.query(By.css('[data-after-subsidy]')).nativeElement.textContent as string;
    expect(text).toContain('floor(vsize / 12)');
    expect(text).not.toContain('3 tokens per');
    expect(text).toContain('Proof of work stays');
    const img = fixture.debugElement.query(By.css('img[src="docs/mill-fee.svg"]'));
    expect(img).toBeTruthy();
  });

  it('shows the public spend menu and validation pictures', () => {
    const menu = fixture.debugElement.query(By.css('[data-spend-menu]')).nativeElement
      .textContent as string;
    expect(menu).toContain('Dilithium 87');
    expect(menu).toContain('secp');
    expect(fixture.debugElement.query(By.css('img[src="docs/public-spend-kinds.svg"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('img[src="docs/public-validate-seq.svg"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('img[src="docs/public-flex-cap.svg"]'))).toBeTruthy();
  });
});
