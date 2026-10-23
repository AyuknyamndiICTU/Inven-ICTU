import type {} from '@fastify/cookie';
import type { AdminRole } from '@labpass/contracts';
import type { FastifyRequest } from 'fastify';

export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  sessionId: string;
}

export interface KioskPrincipal {
  id: string;
  name: string;
}

export interface StudentPrincipal {
  studentId: string;
  credentialId: string;
  familyId: string;
}

export interface LpRequest extends FastifyRequest {
  admin?: AdminPrincipal;
  kiosk?: KioskPrincipal;
  student?: StudentPrincipal;
}

export type Actor =
  | { type: 'ADMIN'; id: string; label: string }
  | { type: 'KIOSK'; id: string; label: string }
  | { type: 'STUDENT'; id: string; label: string }
  | { type: 'SYSTEM'; id: null; label: string };

export function actorOf(req: LpRequest): Actor {
  if (req.admin) return { type: 'ADMIN', id: req.admin.id, label: req.admin.name };
  if (req.kiosk) return { type: 'KIOSK', id: req.kiosk.id, label: req.kiosk.name };
  if (req.student) return { type: 'STUDENT', id: req.student.studentId, label: 'student' };
  return { type: 'SYSTEM', id: null, label: 'system' };
}
