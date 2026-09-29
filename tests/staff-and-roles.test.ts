import { describe, expect, it, vi } from 'vitest';
import { assertKnownPermissions, permissionCatalog } from '../src/modules/identity/permission-catalog.js';
import { authenticate } from '../src/core/http/middleware.js';
import { ForbiddenError, ValidationError } from '../src/core/errors/app-error.js';
import type { Request, Response, NextFunction } from 'express';
import * as authService from '../src/modules/identity/auth.service.js';
import * as accessService from '../src/modules/identity/access.service.js';
import * as staffService from '../src/modules/identity/staff.service.js';
import type { Tx } from '../src/core/db/client.js';

describe('Staff and Roles Management', () => {
  describe('permissionCatalog and assertKnownPermissions', () => {
    it('produces a non-empty permission catalog with modules and codes', () => {
      const catalog = permissionCatalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.some((p) => p.code === 'settings.roles.view')).toBe(true);
      expect(catalog.some((p) => p.code === 'settings.users.manage')).toBe(true);
      expect(catalog.every((p) => Boolean(p.module && p.code))).toBe(true);
    });

    it('assertKnownPermissions accepts valid wildcard and known permissions', () => {
      expect(() => assertKnownPermissions(['*', 'settings.*', 'settings.roles.view'])).not.toThrow();
    });

    it('assertKnownPermissions rejects unknown permissions with ValidationError', () => {
      expect(() => assertKnownPermissions(['totally.bogus.permission'])).toThrow(ValidationError);
    });
  });

  describe('Staff service guard rules', () => {
    const branchA = '00000000-0000-0000-0000-00000000000a';
    const branchB = '00000000-0000-0000-0000-00000000000b';

    const branchAdminAccess: accessService.UserAccess = {
      userId: 'admin-user-1',
      tokenVersion: 1,
      mustChangePassword: false,
      defaultBranchId: branchA,
      branches: [{ id: branchA, code: 'A', name: 'Branch A' }],
      grants: [
        {
          roleCode: 'admin',
          branchId: branchA,
          permissions: ['settings.users.view', 'settings.users.manage', 'settings.roles.view', 'pos.*'],
        },
      ],
    };

    it('No escalation: branch admin at A cannot create a role with global scope or unheld permissions', async () => {
      const mockTx = {
        context: { tenantId: 't1', userId: 'admin-user-1', branchId: branchA },
        maybeOne: vi.fn().mockResolvedValue(null),
      } as unknown as Tx;

      // branchAdminAccess has permissions at Branch A, but createRole requires actor to hold them globally (branchId null)
      await expect(
        staffService.createRole(mockTx, branchAdminAccess, {
          name: 'Manager',
          permissions: ['pos.*'],
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('Owner role: changing its permissions or disabling it is rejected', async () => {
      const mockTx = {
        context: { tenantId: 't1', userId: 'owner-user-1', branchId: null },
        maybeOne: vi.fn().mockResolvedValue({ code: 'owner' }),
      } as unknown as Tx;

      const ownerAccess: accessService.UserAccess = {
        userId: 'owner-user-1',
        tokenVersion: 1,
        mustChangePassword: false,
        defaultBranchId: null,
        branches: [],
        grants: [{ roleCode: 'owner', branchId: null, permissions: ['*'] }],
      };

      await expect(
        staffService.updateRole(mockTx, ownerAccess, 'role-owner-id', {
          permissions: ['pos.view'],
        }),
      ).rejects.toThrow('The Owner role always has full access. It cannot be restricted or disabled.');

      await expect(
        staffService.updateRole(mockTx, ownerAccess, 'role-owner-id', {
          isActive: false,
        }),
      ).rejects.toThrow('The Owner role always has full access. It cannot be restricted or disabled.');
    });

    it('No lockout: deactivating self is rejected', async () => {
      const mockTx = {
        context: { tenantId: 't1', userId: 'owner-user-1', branchId: null },
      } as unknown as Tx;

      const ownerAccess: accessService.UserAccess = {
        userId: 'owner-user-1',
        tokenVersion: 1,
        mustChangePassword: false,
        defaultBranchId: null,
        branches: [],
        grants: [{ roleCode: 'owner', branchId: null, permissions: ['*'] }],
      };

      await expect(
        staffService.setUserActive(mockTx, ownerAccess, 'owner-user-1', false),
      ).rejects.toThrow('You cannot deactivate your own account.');
    });
  });

  describe('Password & authentication middleware', () => {
    it('blocks mustChangePassword user on general routes with 403', async () => {
      vi.spyOn(authService, 'verifyAccessToken').mockReturnValue({
        sub: 'u1',
        tenantId: 't1',
        tv: 1,
      });

      vi.spyOn(accessService, 'getUserAccess').mockResolvedValue({
        userId: 'u1',
        tokenVersion: 1,
        mustChangePassword: true,
        defaultBranchId: null,
        branches: [],
        grants: [{ roleCode: 'sales', branchId: null, permissions: ['pos.*'] }],
      });

      const req = {
        headers: { authorization: 'Bearer token-xyz' },
        originalUrl: '/api/orders',
      } as unknown as Request;

      const res = {} as Response;
      let nextError: unknown = null;
      const next: NextFunction = (err) => {
        nextError = err;
      };

      await authenticate(req, res, next);
      expect(nextError).toBeInstanceOf(ForbiddenError);
      expect((nextError as ForbiddenError).message).toBe('Please set a new password before continuing.');
    });

    it('allows mustChangePassword user on /api/me and /api/me/password', async () => {
      vi.spyOn(authService, 'verifyAccessToken').mockReturnValue({
        sub: 'u1',
        tenantId: 't1',
        tv: 1,
      });

      vi.spyOn(accessService, 'getUserAccess').mockResolvedValue({
        userId: 'u1',
        tokenVersion: 1,
        mustChangePassword: true,
        defaultBranchId: null,
        branches: [],
        grants: [{ roleCode: 'sales', branchId: null, permissions: ['pos.*'] }],
      });

      const req = {
        headers: { authorization: 'Bearer token-xyz' },
        originalUrl: '/api/me',
      } as unknown as Request;

      const res = { setHeader: vi.fn() } as unknown as Response;
      let nextError: unknown = 'sentinel';
      const next: NextFunction = (err) => {
        nextError = err;
      };

      await authenticate(req, res, next);
      expect(nextError).toBeUndefined();
    });
  });
});
