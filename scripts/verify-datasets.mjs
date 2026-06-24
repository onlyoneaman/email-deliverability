#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/generated/domain-data.ts", import.meta.url), "utf8");

function extractStringConst(name) {
  const match = source.match(new RegExp(`export const ${name}: string = (".*?");`, "s"));
  if (!match) throw new Error(`Missing generated string constant: ${name}`);
  return JSON.parse(match[1]);
}

function extractSourceInfo() {
  const match = source.match(/export const DATASET_SOURCE_INFO = ([\s\S]*?) as const;/);
  if (!match) throw new Error("Missing DATASET_SOURCE_INFO");
  return Function(`"use strict"; return (${match[1]});`)();
}

function toDomains(value) {
  return value.length === 0 ? [] : value.split("\n");
}

function assertSortedUnique(name, domains) {
  const seen = new Set();
  let previous = "";
  for (const domain of domains) {
    if (!domain) throw new Error(`${name} contains an empty domain`);
    if (domain !== domain.toLowerCase()) throw new Error(`${name} contains uppercase domain: ${domain}`);
    if (seen.has(domain)) throw new Error(`${name} contains duplicate domain: ${domain}`);
    if (previous && previous.localeCompare(domain) > 0) {
      throw new Error(`${name} is not sorted near: ${previous} > ${domain}`);
    }
    seen.add(domain);
    previous = domain;
  }
}

const free = toDomains(extractStringConst("FREE_DOMAIN_DATA"));
const disposable = toDomains(extractStringConst("DISPOSABLE_DOMAIN_DATA"));
const info = extractSourceInfo();
const freeMeta = info.sources.find((entry) => entry.kind === "free");
const disposableMeta = info.sources.find((entry) => entry.kind === "disposable");

if (!freeMeta || !disposableMeta) throw new Error("Dataset metadata must include free and disposable sources");

assertSortedUnique("FREE_DOMAIN_DATA", free);
assertSortedUnique("DISPOSABLE_DOMAIN_DATA", disposable);

if (free.length !== freeMeta.exactCount) {
  throw new Error(`Free dataset count mismatch: metadata=${freeMeta.exactCount}, actual=${free.length}`);
}

if (disposable.length !== disposableMeta.exactCount) {
  throw new Error(
    `Disposable dataset count mismatch: metadata=${disposableMeta.exactCount}, actual=${disposable.length}`,
  );
}

const disposableSet = new Set(disposable);
const overlap = free.filter((domain) => disposableSet.has(domain));
if (overlap.length > 0) {
  throw new Error(`Free and disposable datasets overlap; first overlaps: ${overlap.slice(0, 10).join(", ")}`);
}

if (freeMeta.exclusionsCount !== disposable.length) {
  throw new Error(
    `Free exclusions should track disposable precedence: exclusions=${freeMeta.exclusionsCount}, disposable=${disposable.length}`,
  );
}

console.log(
  `Dataset verification passed: free=${free.length}, disposable=${disposable.length}, overlap=0, generatedAt=${info.generatedAt}`,
);
