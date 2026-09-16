/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: any;
    admin: import('./admin/auth').AdminIdentity | null;
    adminSurface: boolean;
    anon: string;
    csrf: string;
  }
}
