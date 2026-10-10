import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { WorkspaceNav } from './workspace-nav';

describe('WorkspaceNav', () => {
  it('defaults to Mine and ignores Host a pool on web', () => {
    const nav = TestBed.inject(WorkspaceNav);
    expect(nav.tab()).toBe('mine');
    nav.selectTab('finder', false);
    expect(nav.tab()).toBe('finder');
    nav.selectTab('pool', false);
    expect(nav.tab()).toBe('finder');
    nav.selectTab('pool', true);
    expect(nav.tab()).toBe('pool');
    nav.selectTab('wallet', true);
    expect(nav.tab()).toBe('wallet');
    nav.goMine();
    expect(nav.tab()).toBe('mine');
  });
});
