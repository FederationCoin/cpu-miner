import { TestBed } from '@angular/core/testing';
import { WorkspaceNav } from './workspace-nav';

describe('WorkspaceNav', () => {
  it('blocks Host a pool when the shell has no pool tab and goMine always opens Mine', () => {
    TestBed.resetTestingModule();
    const nav = TestBed.inject(WorkspaceNav);
    expect(nav.tab()).toBe('mine');
    nav.selectTab('finder', false);
    expect(nav.tab()).toBe('finder');
    nav.selectTab('pool', false);
    expect(nav.tab()).toBe('finder');
    nav.selectTab('pool', true);
    expect(nav.tab()).toBe('pool');
    nav.goMine();
    expect(nav.tab()).toBe('mine');
  });
});
