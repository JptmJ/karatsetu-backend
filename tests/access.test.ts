import { describe, it, expect } from 'vitest';
import { resolveBranch, effectiveGrants, type UserAccess } from '../src/modules/identity/access.service.js';
import { normalizePhone } from '../src/modules/identity/auth.service.js';
import { ForbiddenError } from '../src/core/errors/app-error.js';

describe('access.service & auth helpers', () => {
  describe('resolveBranch', () => {
    const mockAccess: UserAccess = {
      userId: 'u1',
      tokenVersion: 1,
      defaultBranchId: 'branch-default',
      branches: [
        { id: 'branch-1', code: 'B1', name: 'Main Showroom' },
        { id: 'branch-default', code: 'BD', name: 'Default Branch' },
      ],
      grants: [],
    };

    it('throws ForbiddenError if requested branch is not accessible', () => {
      expect(() => resolveBranch(mockAccess, 'branch-unauthorized')).toThrow(ForbiddenError);
    });

    it('returns requested branch if accessible', () => {
      expect(resolveBranch(mockAccess, 'branch-1')).toBe('branch-1');
    });

    it('falls back to default branch when no branch is requested', () => {
      expect(resolveBranch(mockAccess, undefined)).toBe('branch-default');
    });

    it('falls back to first branch if default branch is not accessible', () => {
      const accessWithoutDefault: UserAccess = {
        ...mockAccess,
        defaultBranchId: 'branch-foreign',
      };
      expect(resolveBranch(accessWithoutDefault, undefined)).toBe('branch-1');
    });

    it('returns null if branches list is empty and no request', () => {
      const accessEmpty: UserAccess = {
        ...mockAccess,
        defaultBranchId: null,
        branches: [],
      };
      expect(resolveBranch(accessEmpty, undefined)).toBeNull();
    });
  });

  describe('effectiveGrants', () => {
    const access: UserAccess = {
      userId: 'u1',
      tokenVersion: 1,
      defaultBranchId: 'branch-a',
      branches: [
        { id: 'branch-a', code: 'BA', name: 'Branch A' },
        { id: 'branch-b', code: 'BB', name: 'Branch B' },
      ],
      grants: [
        { roleCode: 'sales', branchId: 'branch-a', permissions: ['pos.view', 'pos.create'] },
        { roleCode: 'admin', branchId: 'branch-b', permissions: ['orders.*', 'stock.*'] },
        { roleCode: 'common', branchId: null, permissions: ['reports.owner.view'] },
      ],
    };

    it('returns only sales permissions plus universal grants at Branch A', () => {
      const { roles, permissions } = effectiveGrants(access, 'branch-a');
      expect(roles).toEqual(['sales', 'common']);
      expect(permissions).toContain('pos.view');
      expect(permissions).toContain('pos.create');
      expect(permissions).toContain('reports.owner.view');
      expect(permissions).not.toContain('orders.*');
    });

    it('returns only admin permissions plus universal grants at Branch B', () => {
      const { roles, permissions } = effectiveGrants(access, 'branch-b');
      expect(roles).toEqual(['admin', 'common']);
      expect(permissions).toContain('orders.*');
      expect(permissions).toContain('stock.*');
      expect(permissions).toContain('reports.owner.view');
      expect(permissions).not.toContain('pos.create');
    });
  });

  describe('normalizePhone', () => {
    it('normalizes 10-digit Indian numbers', () => {
      expect(normalizePhone('98765 43210')).toBe('+919876543210');
    });

    it('normalizes numbers with +91 prefix and dashes', () => {
      expect(normalizePhone('+91-9876543210')).toBe('+919876543210');
    });

    it('normalizes 12-digit numbers starting with 91', () => {
      expect(normalizePhone('919876543210')).toBe('+919876543210');
    });
  });
});
