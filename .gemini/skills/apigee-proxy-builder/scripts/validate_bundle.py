#!/usr/bin/env python3
"""Standalone Apigee X proxy bundle validator (no repo dependencies, stdlib only).

Usage:
  python3 validate_bundle.py <path-to-proxy-dir-or-apiproxy-dir-or-zip> [--strict]

Checks:
  * every XML file is well-formed
  * root manifest exists; <Policies>/<Resources>/<ProxyEndpoints>/<TargetEndpoints> match files
  * every <Step><Name> refers to an existing policy; every policy is attached somewhere
  * every RouteRule <TargetEndpoint> exists
  * jsc:// / oas:// / py:// / xsl:// resources referenced by policies exist
  * AI/MCP-policy sanity:
      - LLMTokenQuota / Quota pairs that share <SharedName> agree on Identifier, LLMModelSource,
        Allow/Interval/TimeUnit, and include exactly one EnforceOnly and one CountOnly/Weight side
      - LLMTokenQuota CountOnly policies have <LLMTokenUsageSource>
      - SanitizeUserPrompt / SanitizeModelResponse have <ModelArmor><TemplateName>
      - SemanticCacheLookup has Embeddings + SimilaritySearch; Populate has SimilaritySearch
      - DataCapture `default` attributes are not message templates ("{...}" is recorded literally)
      - conditions reference parsepayload.<name>.* only for an existing ParsePayload policy
      - Quota/LLMTokenQuota with continueOnError="true" + EnforceOnly need a RaiseFault that checks
        ratelimit.<name>.failed / exceed.count (otherwise the limit is never enforced)
Exit code 0 = no errors (warnings allowed unless --strict).
"""
import os
import re
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

ERRORS, WARNINGS = [], []


def err(msg):
    ERRORS.append(msg)


def warn(msg):
    WARNINGS.append(msg)


def parse(path):
    try:
        return ET.parse(path).getroot()
    except ET.ParseError as e:
        err(f"XML parse error in {path}: {e}")
        return None


def text(el, tag):
    if el is None:
        return None
    found = el.find(tag)
    return found.text.strip() if found is not None and found.text else None


def locate_apiproxy(arg):
    if arg.endswith(".zip"):
        tmp = tempfile.mkdtemp(prefix="bundle-")
        with zipfile.ZipFile(arg) as z:
            z.extractall(tmp)
        arg = tmp
    if os.path.basename(os.path.normpath(arg)) == "apiproxy":
        return arg
    cand = os.path.join(arg, "apiproxy")
    if os.path.isdir(cand):
        return cand
    sys.exit(f"Cannot find apiproxy/ under {arg}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv
    if not args:
        sys.exit(__doc__)
    root_dir = locate_apiproxy(args[0])

    # ---- well-formedness of every XML
    xml_files = []
    for d, _, files in os.walk(root_dir):
        for f in files:
            if f.endswith(".xml"):
                xml_files.append(os.path.join(d, f))
    for f in xml_files:
        parse(f)

    manifests = [f for f in os.listdir(root_dir) if f.endswith(".xml")]
    if len(manifests) != 1:
        err(f"expected exactly one root manifest XML in apiproxy/, found {manifests}")
        return report()
    manifest = parse(os.path.join(root_dir, manifests[0]))

    pol_dir = os.path.join(root_dir, "policies")
    policies = {}
    if os.path.isdir(pol_dir):
        for f in sorted(os.listdir(pol_dir)):
            if f.endswith(".xml"):
                el = parse(os.path.join(pol_dir, f))
                if el is not None:
                    name = el.get("name")
                    if name != f[:-4]:
                        err(f"policies/{f}: name attribute '{name}' does not match file name")
                    policies[name] = el

    # ---- manifest lists (optional in Apigee, but if present they must agree)
    if manifest is not None:
        listed = [p.text.strip() for p in manifest.findall("./Policies/Policy") if p.text]
        if listed:
            for p in set(listed) - set(policies):
                err(f"manifest lists policy '{p}' with no policies/{p}.xml")
            for p in set(policies) - set(listed):
                warn(f"policy '{p}' exists but is not listed in the manifest <Policies>")

    # ---- endpoints
    endpoints = []
    targets = set()
    for sub in ("proxies", "targets"):
        d = os.path.join(root_dir, sub)
        if not os.path.isdir(d):
            if sub == "proxies":
                err("missing proxies/ directory")
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".xml"):
                el = parse(os.path.join(d, f))
                if el is not None:
                    endpoints.append((f"{sub}/{f}", el))
                    if sub == "targets":
                        targets.add(el.get("name"))

    attached = set()
    all_conditions = []
    for label, ep in endpoints:
        for step in ep.iter("Step"):
            n = text(step, "Name")
            if n:
                attached.add(n)
                if n not in policies:
                    err(f"{label}: Step references missing policy '{n}'")
            c = text(step, "Condition")
            if c:
                all_conditions.append((label, n, c))
        for c in ep.iter("Condition"):
            if c.text:
                all_conditions.append((label, None, c.text))
        for rr in ep.iter("RouteRule"):
            t = text(rr, "TargetEndpoint")
            if t and t not in targets:
                err(f"{label}: RouteRule '{rr.get('name')}' targets missing TargetEndpoint '{t}'")
    for p in set(policies) - attached:
        warn(f"policy '{p}' is not attached to any Step")

    # ---- resources
    res_dir = os.path.join(root_dir, "resources")
    for name, el in policies.items():
        blob = ET.tostring(el, encoding="unicode")
        for scheme, folder in re.findall(r"\b(jsc|oas|py|xsl|java|properties)://([^<\s\"]+)", blob):
            sub = {"jsc": "jsc", "oas": "oas", "py": "py", "xsl": "xsl", "java": "java", "properties": "properties"}[scheme]
            if not os.path.isfile(os.path.join(res_dir, sub, folder)):
                err(f"policy '{name}' references {scheme}://{folder} but resources/{sub}/{folder} is missing")

    ai_checks(policies, all_conditions)
    return report(strict)


def ai_checks(policies, conditions):
    by_type = {}
    for n, el in policies.items():
        by_type.setdefault(el.tag, []).append((n, el))

    # Shared-counter pairs (Quota + LLMTokenQuota)
    groups = {}
    for tag in ("Quota", "LLMTokenQuota"):
        for n, el in by_type.get(tag, []):
            sn = text(el, "SharedName")
            if sn:
                groups.setdefault((tag, sn), []).append((n, el))
    for (tag, sn), members in groups.items():
        if len(members) < 2:
            continue

        def sig(el):
            allow = el.find("Allow")
            return (
                (el.find("Identifier").get("ref") if el.find("Identifier") is not None else None),
                text(el, "LLMModelSource"),
                (allow.get("countRef"), allow.get("count")) if allow is not None else None,
                (el.find("Interval").get("ref") if el.find("Interval") is not None else None),
                (el.find("TimeUnit").get("ref") if el.find("TimeUnit") is not None else None),
                el.get("type"),
            )
        sigs = {n: sig(el) for n, el in members}
        if len(set(sigs.values())) > 1:
            err(f"{tag} SharedName '{sn}': members disagree on Identifier/LLMModelSource/Allow/Interval/TimeUnit/type {sigs} "
                f"- the enforcer would read a counter nobody writes")
        enforce = [n for n, el in members if (text(el, "EnforceOnly") or "").lower() == "true"]
        count = [n for n, el in members if (text(el, "CountOnly") or "").lower() == "true" or el.find("Weight") is not None]
        if not enforce:
            warn(f"{tag} SharedName '{sn}': no EnforceOnly member")
        if not count:
            warn(f"{tag} SharedName '{sn}': no CountOnly/Weight member")
        for n, el in members:
            if (text(el, "EnforceOnly") or "").lower() != "true" and el.find("Weight") is None \
                    and (text(el, "CountOnly") or "").lower() != "true" and tag == "Quota":
                warn(f"Quota '{n}' shares '{sn}' without EnforceOnly/Weight - it silently adds weight 1 per call")

    for n, el in by_type.get("LLMTokenQuota", []):
        if (text(el, "CountOnly") or "").lower() == "true" and text(el, "LLMTokenUsageSource") is None:
            warn(f"LLMTokenQuota '{n}' is CountOnly without <LLMTokenUsageSource> (default is Gemini usageMetadata)")

    # Swallowed enforcers need an explicit RaiseFault
    cond_blob = " ".join(c for _, _, c in conditions)
    for tag in ("Quota", "LLMTokenQuota"):
        for n, el in by_type.get(tag, []):
            if el.get("continueOnError") == "true" and (text(el, "EnforceOnly") or "").lower() == "true":
                if f"ratelimit.{n}." not in cond_blob:
                    err(f"{tag} '{n}' is EnforceOnly with continueOnError=true but no Step condition checks "
                        f"ratelimit.{n}.failed/exceed.count - the limit is never enforced")

    for tag in ("SanitizeUserPrompt", "SanitizeModelResponse"):
        for n, el in by_type.get(tag, []):
            if el.find("./ModelArmor/TemplateName") is None:
                err(f"{tag} '{n}' missing <ModelArmor><TemplateName>")
            if el.find("Source") is not None:
                err(f"{tag} '{n}' has <Source> - not a valid element (use UserPromptSource / LLMResponseSource)")

    for n, el in by_type.get("SemanticCacheLookup", []):
        if el.find("./Embeddings/VertexAI/URL") is None or el.find("./SimilaritySearch/VertexAI") is None:
            err(f"SemanticCacheLookup '{n}' needs <Embeddings><VertexAI><URL> and <SimilaritySearch><VertexAI>")
        if el.find("CacheConfig") is not None:
            err(f"SemanticCacheLookup '{n}' uses <CacheConfig> - not valid Apigee X syntax")
    for n, el in by_type.get("SemanticCachePopulate", []):
        if el.find("./SimilaritySearch/VertexAI/URL") is None:
            err(f"SemanticCachePopulate '{n}' needs <SimilaritySearch><VertexAI><URL> (…:upsertDatapoints)")

    for n, el in by_type.get("DataCapture", []):
        for c in el.iter("Collect"):
            d = c.get("default") or ""
            if "{" in d:
                err(f"DataCapture '{n}': default=\"{d}\" is recorded literally (not a message template)")

    pp_names = {n for n, _ in by_type.get("ParsePayload", [])}
    for label, step, c in conditions:
        for ref in set(re.findall(r"parsepayload\.([A-Za-z0-9_-]+)\.", c)):
            if ref not in pp_names:
                err(f"{label}: condition references parsepayload.{ref}.* but no ParsePayload policy '{ref}' exists")


def report(strict=False):
    for w in WARNINGS:
        print(f"WARN  {w}")
    for e in ERRORS:
        print(f"ERROR {e}")
    ok = not ERRORS and not (strict and WARNINGS)
    print(f"\n{'PASS' if ok else 'FAIL'}: {len(ERRORS)} error(s), {len(WARNINGS)} warning(s)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
