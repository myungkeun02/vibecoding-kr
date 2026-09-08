/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: any;
    anon: string;
    csrf: string;
  }
}
