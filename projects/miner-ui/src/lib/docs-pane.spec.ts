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
    expect(text).toContain('3 tokens per');
    expect(text).toContain('Proof of work stays');
    const img = fixture.debugElement.query(By.css('img[src="docs/mill-fee.svg"]'));
    expect(img).toBeTruthy();
  });
});
