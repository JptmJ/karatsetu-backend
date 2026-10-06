import { describe, expect, it, vi } from 'vitest';
import '../src/api/index.js';
import { assertKnownPermissions, permissionCatalog } from '../src/modules/identity/permission-catalog.js';
import { authenticate } from '../src/core/http/middleware.js';
import { allRoutes } from '../src/core/http/route-registry.js';
import { ForbiddenError, ValidationError } from '../src/core/errors/app-error.js';
import type { Request, Response, NextFunction } from 'express';
import * as authService from '../src/modules/identity/auth.service.js';
import * as accessService from '../src/modules/identity/access.service.js';
import * as staffService from '../src/modules/identity/staff.service.js';
import {
  PLATFORM_ROLE_CODES, platformPermissionsFor, platformRole, ROLE_TYPES, SUPER_ADMIN, TENANT_ROLES,
} from '../src/modules/platform/roles.js';
import { hasPermission } from '../src/modules/identity/permissions.js';
import { permissionTree } from '../src/modules/identity/permission-catalog.js';
import { assertCanWrite, type LiveSession } from '../src/modules/platform/support-session.service.js';

describe('Staff and Roles Management', () => {
  describe('permissionCatalog and assertKnownPermissions', () => {
    it('produces a non-empty permission catalog with modules and codes', () => {
      const catalog = permissionCatalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.some((p) => p.code === 'settings.roles.view')).toBe(true);
      expect(catalog.every((p) => Boolean(p.module && p.code))).toBe(true);
    });

    it('no longer offers the staff and role management permissions to a business', () => {
      // The endpoints behind these are gone, so the catalog — which is built
      // from the live routes — must not advertise them either.
      const codes = permissionCatalog().map((p) => p.code);
      expect(codes).not.toContain('settings.users.manage');
      expect(codes).not.toContain('settings.roles.manage');
    });

    it('assertKnownPermissions accepts valid wildcard and known permissions', () => {
      expect(() => assertKnownPermissions(['*', 'settings.*', 'settings.roles.view'])).not.toThrow();
    });

    it('assertKnownPermissions rejects unknown permissions with ValidationError', () => {
      expect(() => assertKnownPermissions(['totally.bogus.permission'])).toThrow(ValidationError);
    });
  });

  describe('The platform role', () => {
    it('is one role holding everything', () => {
      expect(SUPER_ADMIN.code).toBe('super_admin');
      expect(platformPermissionsFor('super_admin')).toEqual(['*']);
    });

    it('recognises no other platform role', () => {
      expect(PLATFORM_ROLE_CODES).toEqual(['super_admin']);
      for (const gone of ['support_engineer', 'sales_onboarding', 'billing_admin']) {
        expect(platformRole(gone)).toBeUndefined();
        expect(platformPermissionsFor(gone)).toEqual([]);
      }
    });

    it('satisfies every platform permission a route enforces', () => {
      // One operator holding '*' must be able to reach everything this console
      // declares, or a page would 403 with nobody able to fix it.
      const enforced = allRoutes()
        .map((r) => r.permission)
        .filter((x) => Boolean(x && x.startsWith('platform.')));

      expect(enforced.length).toBeGreaterThan(0);
      for (const permission of new Set(enforced)) {
        expect(hasPermission(new Set(platformPermissionsFor('super_admin')), permission)).toBe(true);
      }
    });
  });

  describe('Tenant roles: owner, branch admin, staff', () => {
    it('seeds only the two fixed roles, and knows three types', () => {
      expect(TENANT_ROLES.map((r) => r.code)).toEqual(['owner', 'admin']);
      expect(ROLE_TYPES).toEqual(['owner', 'admin', 'staff']);
    });

    it('drops the four roles that no longer exist', () => {
      const codes = TENANT_ROLES.map((r) => r.code);
      for (const gone of ['sales', 'cashier', 'accountant', 'storekeeper']) {
        expect(codes).not.toContain(gone);
      }
    });

    it('gives the owner everything', () => {
      const owner = TENANT_ROLES.find((r) => r.code === 'owner')!;
      expect(owner.permissions).toEqual(['*']);
      expect(owner.type).toBe('owner');
    });

    it('lets a branch admin run their branch, its branches and staff activation', () => {
      const admin = TENANT_ROLES.find((r) => r.code === 'admin')!;
      expect(admin.type).toBe('admin');
      // master.* is what lets them add and edit the shop's own branches.
      expect(admin.permissions).toContain('master.*');
      expect(admin.permissions).toContain('settings.users.view');
      expect(admin.permissions).toContain('settings.users.status');
      // Still not theirs: creating people, or deciding what a role reaches.
      expect(admin.permissions).not.toContain('settings.users.manage');
      expect(admin.permissions).not.toContain('settings.roles.manage');
    });

    it('exposes only the status toggle to a business, and no role editing', () => {
      for (const gone of [
        'createUser', 'updateUser', 'replaceAssignments', 'resetPassword',
        'createRole', 'updateRole', 'deleteRole',
      ]) {
        expect(staffService).not.toHaveProperty(gone);
      }
      expect(typeof staffService.setUserActive).toBe('function');
      expect(typeof staffService.listUsers).toBe('function');
      expect(typeof staffService.listRoles).toBe('function');
    });

    it('routes staff work to the console, keeping only the status toggle in the shop', () => {
      const paths = allRoutes().map((r) => `${r.method.toUpperCase()} ${r.path}`);
      for (const gone of [
        'POST /api/settings/users',
        'PATCH /api/settings/users/:id',
        'PUT /api/settings/users/:id/roles',
        'POST /api/settings/users/:id/reset-password',
        'POST /api/settings/roles',
        'PUT /api/settings/roles/:id',
        'DELETE /api/settings/roles/:id',
      ]) {
        expect(paths).not.toContain(gone);
      }
      expect(paths).toContain('GET /api/settings/users');
      expect(paths).toContain('POST /api/settings/users/:id/status');
      expect(paths).toContain('POST /api/platform/tenants/:id/users');
      expect(paths).toContain('POST /api/platform/tenants/:id/roles');
      expect(paths).toContain('PATCH /api/platform/tenants/:id/roles/:roleId');
      expect(paths).toContain('GET /api/platform/permission-tree');
    });
  });

  describe('The staff role builder', () => {
    it('offers only permissions that a route enforces', () => {
      const tree = permissionTree();
      expect(tree.length).toBeGreaterThan(0);

      const known = new Set(permissionCatalog().map((p) => p.code));
      for (const module of tree) {
        for (const group of module.groups) {
          expect(group.permissions.length).toBeGreaterThan(0);
          for (const leaf of group.permissions) expect(known.has(leaf.code)).toBe(true);
        }
      }
    });

    it('accepts every wildcard it offers', () => {
      // Ticking "all of Billing" has to produce a string the backend will take.
      const tree = permissionTree();
      const wildcards = [
        ...tree.map((m) => m.wildcard),
        ...tree.flatMap((m) => m.groups.map((g) => g.wildcard).filter((w): w is string => Boolean(w))),
      ];
      expect(wildcards.length).toBeGreaterThan(0);
      expect(() => assertKnownPermissions(wildcards)).not.toThrow();
    });

    it('puts a module’s own actions under the module, and sub-areas beside them', () => {
      const pos = permissionTree().find((m) => m.key === 'pos');
      expect(pos).toBeDefined();

      // pos.view lands in the group named after the module itself.
      const own = pos!.groups.find((g) => g.key === 'pos');
      expect(own?.permissions.some((p) => p.action === 'view')).toBe(true);
      expect(own?.wildcard).toBeNull();

      // pos.purchase.* is a sub-area carrying its own wildcard.
      const purchase = pos!.groups.find((g) => g.key === 'pos.purchase');
      expect(purchase?.wildcard).toBe('pos.purchase.*');
    });
  });

  describe('Support sessions', () => {
    const session = (canWrite: boolean): LiveSession => ({
      id: 's1', tenantId: 't1', operatorId: 'op1', canWrite,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    });

    it('lets a read-only session read', () => {
      expect(() => assertCanWrite(session(false), 'GET')).not.toThrow();
      expect(() => assertCanWrite(session(false), 'HEAD')).not.toThrow();
    });

    it('refuses every write from a read-only session', () => {
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        expect(() => assertCanWrite(session(false), method)).toThrow(ForbiddenError);
      }
    });

    it('allows writes once the session is escalated', () => {
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        expect(() => assertCanWrite(session(true), method)).not.toThrow();
      }
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
        fullName: 'Test User',
        email: 'u1@example.com',
        phone: null,
        tenantActive: true,
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
        fullName: 'Test User',
        email: 'u1@example.com',
        phone: null,
        tenantActive: true,
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
