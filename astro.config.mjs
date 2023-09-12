import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel/serverless";

import webmanifest from "astro-webmanifest";

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [webmanifest({
    name: "GymLingo",
    lang: "cz"
  })]
});