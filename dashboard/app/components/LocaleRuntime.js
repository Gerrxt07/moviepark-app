"use client";

import { useLayoutEffect } from "react";
import { readLocale } from "../lib/locale";
import { translateAttribute, translateText } from "../i18n/catalog";

const BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);
const TRANSLATED_ATTRIBUTES = ["aria-label", "placeholder", "title", "alt"];

function translateNode(node, locale) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || BLOCKED_TAGS.has(parent.tagName)) return;
    const translated = translateText(node.nodeValue, locale);
    if (translated !== node.nodeValue) node.nodeValue = translated;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || BLOCKED_TAGS.has(node.tagName)) return;
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    if (!node.hasAttribute(attribute)) continue;
    const current = node.getAttribute(attribute);
    const translated = translateAttribute(current, locale);
    if (translated !== current) node.setAttribute(attribute, translated);
  }
  for (const child of node.childNodes) translateNode(child, locale);
}

export default function LocaleRuntime() {
  useLayoutEffect(() => {
    const locale = readLocale();
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    translateNode(document.body, locale);
    document.title = translateText(document.title, locale);
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = translateText(description.content, locale);

    let translating = false;
    const observer = new MutationObserver((records) => {
      if (translating) return;
      translating = true;
      observer.disconnect();
      for (const record of records) {
        if (record.type === "characterData") translateNode(record.target, locale);
        if (record.type === "attributes") translateNode(record.target, locale);
        for (const node of record.addedNodes) translateNode(node, locale);
      }
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRIBUTES });
      translating = false;
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRIBUTES });
    document.documentElement.dataset.localeReady = "true";
    return () => observer.disconnect();
  }, []);
  return null;
}
