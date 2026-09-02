"""
War Chest — controlled tag vocabulary and derivation rules.

Tags are FACETED. Every tag is stored as "facet:value" so the UI can group
filters and so two facets never collide (e.g. domain:design vs stack:figma).

Facets
------
domain      What area of work the skill belongs to.        (0-3 per skill)
capability  What the skill does to that area.              (0-3 per skill)
stack       Concrete technology, product or API involved.  (0-6 per skill)
format      Artifact the skill produces or consumes.       (0-3 per skill)
agent       Agent/client the skill explicitly targets.     (0-2 per skill)
trait       Structural facts derived from the files, not from text. (0-6)

Derivation
----------
Each keyword tag owns a list of regex patterns. A pattern hit scores by WHERE
it hit, because signal strength differs by field:

    name / directory path .... 6   (path is scoped BELOW the source root, so
    description .............. 5    repo folder names never leak into tags)
    body headings ............ 2
    body text ................ 1   (capped at 3 total from body text)

THRESHOLD is 5, which reduces to a rule you can hold in your head:
a hit in the name, the path, or the description fires the tag; a body-only
mention needs both a heading and repeated prose before it counts.
Same input always yields the same tags, so builds are diffable.

Trait tags are NOT keyword-derived. They come from the file tree and the
frontmatter, so they are always true.
"""

import re

THRESHOLD = 5
FIELD_WEIGHT = {"name": 6, "path": 6, "desc": 5, "head": 2, "body": 1}
BODY_CAP = 3

FACETS = ["domain", "capability", "stack", "format", "agent", "trait"]

FACET_LABELS = {
    "domain": "Domain",
    "capability": "Capability",
    "stack": "Stack",
    "format": "Format",
    "agent": "Agent",
    "trait": "Trait",
}

# --------------------------------------------------------------------------
# Keyword rules. Patterns are case-insensitive regexes matched with re.search.
# Use \b anchors aggressively — short tokens like "go" or "ci" are landmines.
# --------------------------------------------------------------------------

RULES = {
    # ---- domain -----------------------------------------------------------
    "domain:web": [r"\bweb\b", r"\bfrontend\b", r"\bbrowser\b", r"\bwebsite\b", r"\blanding page\b", r"\bhtml\b"],
    "domain:mobile": [r"\bmobile\b", r"\bios\b", r"\bandroid\b", r"\bapp store\b", r"\bswiftui\b", r"\bexpo\b"],
    "domain:backend": [r"\bbackend\b", r"\bserver[- ]side\b", r"\bapi\b", r"\bendpoint\b", r"\bmicroservice\b"],
    "domain:cloud-infra": [r"\bcloud\b", r"\binfrastructure\b", r"\bdeployment\b", r"\bkubernetes\b", r"\bserverless\b", r"\bgke\b", r"\bcloud run\b"],
    "domain:data": [r"\bdata(set|base)?\b", r"\bsql\b", r"\banalytics\b", r"\betl\b", r"\bpipeline\b", r"\bwarehouse\b"],
    "domain:ml-ai": [r"\bmachine learning\b", r"\bml\b", r"\bmodel\b", r"\bllm\b", r"\binference\b", r"\bembedding\b", r"\bfine[- ]tun", r"\btraining\b", r"\bai agent\b", r"\bagentic\b"],
    "domain:design": [r"\bdesign\b", r"\bvisual\b", r"\btypograph", r"\bcolor\b", r"\bbrand\b", r"\bfigma\b", r"\baesthetic\b"],
    "domain:ui-ux": [r"\bui\b", r"\bux\b", r"\binterface\b", r"\bcomponent\b", r"\blayout\b", r"\bdesign system\b"],
    "domain:animation": [r"\banimat", r"\bmotion\b", r"\btransition\b", r"\beasing\b", r"\bspring\b", r"\bscroll[- ]driven\b"],
    "domain:game-dev": [r"\bgame\b", r"\bgameplay\b", r"\benemy\b", r"\bcombat\b", r"\bplayer\b", r"\blevel design\b", r"\bnpc\b"],
    "domain:devops": [r"\bci/?cd\b", r"\bpipeline\b", r"\bgithub actions\b", r"\bdocker\b", r"\brelease\b", r"\bmonitoring\b", r"\bobservability\b"],
    "domain:security": [r"\bsecurity\b", r"\bauth(entication|orization)?\b", r"\boauth\b", r"\bvulnerab", r"\bsecret", r"\bencrypt"],
    "domain:testing": [r"\btest(s|ing)?\b", r"\bunit test\b", r"\be2e\b", r"\bcoverage\b", r"\bassertion\b", r"\bregression\b"],
    "domain:docs-writing": [r"\bdocumentation\b", r"\bdocs\b", r"\bwriting\b", r"\breadme\b", r"\bchangelog\b", r"\bcopywriting\b"],
    "domain:product": [r"\bproduct\b", r"\broadmap\b", r"\bmvp\b", r"\bfeature spec\b", r"\buser stor"],
    "domain:marketing": [r"\bmarketing\b", r"\bseo\b", r"\bcampaign\b", r"\bads?\b", r"\blaunch post\b", r"\bsocial media\b"],
    "domain:business": [r"\bpricing\b", r"\brevenue\b", r"\bbusiness\b", r"\bstartup\b", r"\bfounder\b", r"\bcustomer\b"],
    "domain:research": [r"\bresearch\b", r"\bliterature\b", r"\bbenchmark\b", r"\bevaluat", r"\bexperiment\b"],
    "domain:media": [r"\bvideo\b", r"\baudio\b", r"\bimage generation\b", r"\bscreenshot\b", r"\brecording\b", r"\btts\b", r"\bvoice\b"],
    "domain:automation": [r"\bautomat", r"\bworkflow\b", r"\bscript(ing)?\b", r"\bbatch\b", r"\bscheduled?\b"],
    "domain:agent-workflow": [r"\bhand ?off\b", r"\bretro(spective)?\b", r"\bcontext (window|management|engineering)\b", r"\bprompt(ing|s)?\b", r"\bsub-?agent\b", r"\bskill (author|creat|writ)", r"\bagents?\.md\b", r"\bclaude\.md\b"],
    "domain:dx": [r"\bdeveloper experience\b", r"\bdx\b", r"\btooling\b", r"\bmonorepo\b", r"\blinting\b", r"\bformatter\b"],

    # ---- capability -------------------------------------------------------
    "capability:build": [r"\bbuild\b", r"\bcreate\b", r"\bimplement\b", r"\bscaffold\b", r"\bgenerate\b", r"\bship\b"],
    "capability:review": [r"\breview\b", r"\bcritique\b", r"\bfeedback\b", r"\bcode review\b"],
    "capability:audit": [r"\baudit\b", r"\binspect\b", r"\bcompliance\b", r"\bverify\b", r"\bvalidat"],
    "capability:debug": [r"\bdebug\b", r"\btroubleshoot\b", r"\bdiagnos", r"\bfix(ing)?\b", r"\berror\b"],
    "capability:refactor": [r"\brefactor\b", r"\bclean ?up\b", r"\brestructur", r"\brewrite\b", r"\bsimplif"],
    "capability:migrate": [r"\bmigrat", r"\bupgrade\b", r"\bport(ing)?\b", r"\bdeprecat"],
    "capability:analyze": [r"\banaly[sz]", r"\bprofil", r"\bmeasure\b", r"\bmetrics\b", r"\breport(ing)?\b"],
    "capability:plan": [r"\bplan(ning)?\b", r"\bspec\b", r"\barchitect", r"\bstrategy\b", r"\bdecide\b", r"\bincremental\b", r"\bstep[- ]by[- ]step\b"],
    "capability:test": [r"\bwrite tests?\b", r"\btest suite\b", r"\bplaywright\b", r"\bvitest\b", r"\bjest\b"],
    "capability:deploy": [r"\bdeploy\b", r"\bpublish\b", r"\brelease\b", r"\bhost(ing)?\b"],
    "capability:optimize": [r"\boptimi[sz]", r"\bperformance\b", r"\bspeed ?up\b", r"\bbundle size\b", r"\bcore web vitals\b"],
    "capability:document": [r"\bdocument\b", r"\bwrite docs\b", r"\bexplain\b", r"\bsummari[sz]"],
    "capability:extract": [r"\bextract\b", r"\bscrape\b", r"\bparse\b", r"\bingest\b"],
    "capability:convert": [r"\bconvert\b", r"\btransform\b", r"\btranslate\b", r"\bexport\b"],
    "capability:orchestrate": [r"\borchestrat", r"\bsub-?agent\b", r"\bmulti-?agent\b", r"\bdelegate\b", r"\bpipeline\b"],
    "capability:teach": [r"\bteach\b", r"\btutor", r"\bquiz\b", r"\bgrill\b", r"\bsocratic\b", r"\bexplain like\b", r"\bwalk (me|you) through\b"],
    "capability:prototype": [r"\bprototyp", r"\bmock ?up\b", r"\bwireframe\b", r"\bproof of concept\b"],

    # ---- stack ------------------------------------------------------------
    "stack:react": [r"\breact\b", r"\bjsx\b", r"\bhooks?\b"],
    "stack:nextjs": [r"\bnext\.?js\b", r"\bapp router\b", r"\bserver components?\b"],
    "stack:typescript": [r"\btypescript\b", r"\.tsx?\b", r"\btype[- ]safe\b"],
    "stack:javascript": [r"\bjavascript\b", r"\bes6\b", r"\bnpm\b"],
    "stack:python": [r"\bpython\b", r"\bpip\b", r"\buv\b", r"\bpytest\b"],
    "stack:swift": [r"\bswift(ui)?\b", r"\bxcode\b"],
    "stack:kotlin": [r"\bkotlin\b", r"\bjetpack compose\b"],
    "stack:android": [r"\bandroid\b", r"\bgradle\b", r"\bplay store\b"],
    "stack:ios": [r"\bios\b", r"\bapp store\b", r"\buikit\b"],
    "stack:node": [r"\bnode\.?js\b", r"\bpnpm\b", r"\byarn\b"],
    "stack:tailwind": [r"\btailwind\b"],
    "stack:css": [r"\bcss\b", r"\bflexbox\b", r"\bgrid layout\b", r"\bstylesheet\b"],
    "stack:threejs": [r"\bthree\.?js\b", r"\bwebgl\b", r"\br3f\b", r"\breact three fiber\b"],
    "stack:gsap": [r"\bgsap\b", r"\bscrolltrigger\b", r"\blenis\b"],
    "stack:motion": [r"\bframer motion\b", r"\bmotion\.dev\b", r"\bmotion one\b"],
    "stack:sql": [r"\bsql\b", r"\bpostgres\b", r"\bbigquery\b", r"\bsqlite\b"],
    "stack:docker": [r"\bdocker\b", r"\bcontainer image\b"],
    "stack:kubernetes": [r"\bkubernetes\b", r"\bk8s\b", r"\bgke\b", r"\bhelm\b"],
    "stack:terraform": [r"\bterraform\b", r"\biac\b"],
    "stack:gcp": [r"\bgoogle cloud\b", r"\bgcp\b", r"\bcloud run\b", r"\bvertex ai\b", r"\bbigquery\b"],
    "stack:aws": [r"\baws\b", r"\blambda\b", r"\bs3\b", r"\bdynamodb\b"],
    "stack:firebase": [r"\bfirebase\b", r"\bfirestore\b"],
    "stack:google-ads": [r"\bgoogle ads\b", r"\bads api\b", r"\badmob\b", r"\bdata manager api\b"],
    "stack:gemini": [r"\bgemini\b", r"\bgoogle ai studio\b"],
    "stack:git": [r"\bgit\b", r"\bcommit\b", r"\bbranch\b", r"\brebase\b"],
    "stack:github": [r"\bgithub\b", r"\bpull request\b", r"\bgithub actions\b"],
    "stack:huggingface": [r"\bhugging ?face\b", r"\bhf hub\b", r"\bspaces?\b", r"\btransformers\b", r"\bdiffusers\b"],
    "stack:pytorch": [r"\bpytorch\b", r"\btorch\b", r"\bcuda\b"],
    "stack:mcp": [r"\bmcp\b", r"\bmodel context protocol\b"],
    "stack:playwright": [r"\bplaywright\b", r"\bpuppeteer\b", r"\bheadless browser\b"],
    "stack:expo": [r"\bexpo\b", r"\breact native\b"],
    "stack:rust": [r"\brust\b", r"\bcargo\b"],
    "stack:go": [r"\bgolang\b", r"\bgo modules?\b"],
    "stack:figma": [r"\bfigma\b"],
    "stack:blender": [r"\bblender\b", r"\bgltf\b", r"\bglb\b", r"\brigging\b"],
    "stack:elevenlabs": [r"\belevenlabs\b"],
    "stack:unsplash": [r"\bunsplash\b"],

    # ---- format -----------------------------------------------------------
    "format:pdf": [r"\bpdf\b"],
    "format:office": [r"\bdocx\b", r"\bxlsx\b", r"\bpptx\b", r"\bword document\b", r"\bspreadsheet\b", r"\bpowerpoint\b"],
    "format:slides": [r"\bslide deck\b", r"\bpresentation\b", r"\bslides\b"],
    "format:image": [r"\bimage\b", r"\bpng\b", r"\bsvg\b", r"\bscreenshot\b", r"\bthumbnail\b"],
    "format:video": [r"\bvideo\b", r"\bmp4\b", r"\bscreen recording\b", r"\bgif\b"],
    "format:audio": [r"\baudio\b", r"\bmp3\b", r"\bsound effect\b", r"\bvoiceover\b"],
    "format:markdown": [r"\bmarkdown\b", r"\bmdx\b"],
    "format:cli": [r"\bcli\b", r"\bcommand[- ]line\b", r"\bterminal\b", r"\bshell script\b"],
    "format:api": [r"\brest api\b", r"\bgraphql\b", r"\bopenapi\b", r"\bwebhook\b"],

    # ---- agent ------------------------------------------------------------
    "agent:claude-code": [r"\bclaude code\b", r"\bclaude\.md\b", r"\banthropic\b"],
    "agent:codex": [r"\bcodex\b", r"\bopenai\b"],
    "agent:gemini-cli": [r"\bgemini cli\b", r"\bgemini-extension\b"],
    "agent:cursor": [r"\bcursor\b"],
    "agent:copilot": [r"\bcopilot\b"],
}

# Tags whose only reliable signal is the name/path — never fire on body text.
NAME_PATH_ONLY = {"stack:go", "stack:git", "domain:dx"}


def derive_tags(name, path, description, headings, body):
    """Return (sorted tag list, {tag: score}) for one skill."""
    fields = {
        "name": name.replace("-", " "),
        "path": path.replace("/", " ").replace("-", " "),
        "desc": description or "",
        "head": "\n".join(headings),
        "body": body or "",
    }
    scores = {}
    for tag, patterns in RULES.items():
        total = 0
        body_pts = 0
        for field, text in fields.items():
            if not text:
                continue
            if tag in NAME_PATH_ONLY and field not in ("name", "path"):
                continue
            for pat in patterns:
                if re.search(pat, text, re.I):
                    if field == "body":
                        body_pts = min(BODY_CAP, body_pts + FIELD_WEIGHT[field])
                    else:
                        total += FIELD_WEIGHT[field]
                    break  # one hit per field per tag
        total += body_pts
        if total >= THRESHOLD:
            scores[tag] = total
    return sorted(scores, key=lambda t: (-scores[t], t)), scores


def cap_by_facet(tags, scores, caps=None):
    """Keep only the strongest N tags per facet so cards stay readable."""
    caps = caps or {"domain": 3, "capability": 3, "stack": 6, "format": 3, "agent": 2}
    kept, seen = [], {}
    for tag in sorted(tags, key=lambda t: (-scores.get(t, 0), t)):
        facet = tag.split(":", 1)[0]
        limit = caps.get(facet)
        if limit is None or seen.get(facet, 0) < limit:
            kept.append(tag)
            seen[facet] = seen.get(facet, 0) + 1
    return sorted(kept)
