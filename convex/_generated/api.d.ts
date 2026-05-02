/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as bibleVersions from "../bibleVersions.js";
import type * as churches from "../churches.js";
import type * as emails from "../emails.js";
import type * as globalAppSettings from "../globalAppSettings.js";
import type * as invitations from "../invitations.js";
import type * as liveSessions from "../liveSessions.js";
import type * as migration from "../migration.js";
import type * as presence from "../presence.js";
import type * as schedules from "../schedules.js";
import type * as slides from "../slides.js";
import type * as songs from "../songs.js";
import type * as templates from "../templates.js";
import type * as transcripts from "../transcripts.js";
import type * as users from "../users.js";
import type * as verseEmbeddings from "../verseEmbeddings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  bibleVersions: typeof bibleVersions;
  churches: typeof churches;
  emails: typeof emails;
  globalAppSettings: typeof globalAppSettings;
  invitations: typeof invitations;
  liveSessions: typeof liveSessions;
  migration: typeof migration;
  presence: typeof presence;
  schedules: typeof schedules;
  slides: typeof slides;
  songs: typeof songs;
  templates: typeof templates;
  transcripts: typeof transcripts;
  users: typeof users;
  verseEmbeddings: typeof verseEmbeddings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
