# Codebook: Official U.S. Government Messaging

Unit of analysis: one post. For tweets and Truth Social posts that is the full text. For
WhiteHouse.gov items it is the title plus the first ~90 words (the lede), so long documents and
short posts are judged on a comparable span.

Teacher labels were assigned **blind**: the coder saw only the text, shuffled across sources, with
no account, date, administration or engagement shown. Reposts (RT/ReTruth) and posts with no text
were not labeled.

Every continuous dimension runs from −1 to +1, with 0 meaning neutral, balanced, or not
applicable. As in the tithing study, the −1 pole is the "harder" or norm-departing pole and +1 the
"softer" or institutional pole, so higher is more conventional on every scale except ideology.

The design mirrors *Preserving Policy Through Narrative Transformation* (Overstreet, forthcoming).
Ideology replaces the doctrinal dimensions. Partisanship and Personalization are written so they
line up with the two federal legal standards for official communications:

- GAO's reading of the appropriations-act ban on "publicity or propaganda." Its tests are
  *purely partisan* material, *self-aggrandizement*/puffery, and *covert propaganda*.
- The Hatch Act's bar on partisan political activity from official accounts.

---

## Continuous dimensions

### 1. Ideology — Liberal (−1) ↔ Conservative (+1)
Where the message's policy content and values sit in the contemporary U.S. left–right space.
Apolitical service content is 0. Nationalist-populist positions of the Trump-era coalition
(tariffs, "America First," mass deportation) code right.

- **−1 anchor:** "Climate change is the existential threat of our time. We're rejoining the Paris
  Agreement, investing in clean energy jobs, protecting transgender Americans, and building an
  immigration system that treats every migrant with dignity. Health care is a right, not a
  privilege."
- **0 anchor:** "The passport office will be closed Monday for the federal holiday. Travelers with
  urgent needs should call the 24-hour line. Happy Fourth of July to all Americans at home and
  abroad."
- **+1 anchor:** "We are securing the border, deporting criminal illegal aliens, cutting taxes and
  job-killing regulations, unleashing American energy, and ending woke DEI programs. The Second
  Amendment will never be infringed. America First!"

### 2. Professionalism — Unprofessional (−1) ↔ Professional (+1)
The register and decorum expected of an official government communication, separate from
ideology.

- **−1 anchor:** "Crooked loser Schiff is a LOW IQ lunatic and a total disgrace!!! FAKE NEWS won't
  report it. SAD!" (Insults, name-calling, shouting, mockery, memes, slang or profanity,
  conspiracy claims, personal grievance, threats, dehumanizing language.)
- **0 anchor:** "Big news today! 🇺🇸 Thrilled to welcome our partners to Washington — great things
  ahead. #Jobs" (Conversational or promotional, but within bounds.)
- **+1 anchor:** "Today the Secretary met with the Foreign Minister to discuss maritime security,
  trade, and humanitarian assistance. The full readout is available at state.gov." (Formal,
  precise, measured, factual, institutional.)

### 3. Partisanship — Partisan (−1) ↔ Nonpartisan/civic (+1)
How far the message attacks or credits a party, partisan figures, or campaigns, or makes an
electoral appeal. This is the Hatch Act and GAO "purely partisan" axis.

- **−1 anchor:** "The Radical Left Democrats and their Do-Nothing Congress want open borders and
  higher taxes. Vote Republican in November and stop them!"
- **0 anchor:** "The President's plan would lower prescription drug prices. Congress should pass
  it." (Advocates the administration's agenda without partisan attack.)
- **+1 anchor:** "Members of both parties joined today to honor the fallen. We are one nation,
  grateful for those who serve." (Civic, unifying, service-oriented.)

### 4. Threat ↔ Hope — Threat/fear (−1) ↔ Hope/benefit (+1)
The Narrative Policy Framework's devil–angel shift.

- **−1 anchor:** "Our country is being invaded. Violent criminals and deadly fentanyl are pouring
  across the border, and the people responsible are destroying our nation."
- **0 anchor:** "The Department released its quarterly report on border encounters and processing
  times."
- **+1 anchor:** "Wages are rising, families are thriving, and a brighter future is within reach.
  We are grateful and proud of what Americans are building together."

### 5. Personalization — Leader-centered (−1) ↔ Institution/public-centered (+1)
Whether the message centers the leader's persona: glorification, self-praise, ratings, crowds,
loyalty, grievances. This is the GAO self-aggrandizement axis.

- **−1 anchor:** "Nobody has done more for this country than President Trump. Record crowds, the
  highest poll numbers ever, and he is being treated worse than any President in history."
- **0 anchor:** "President Biden signed the bill into law today at the White House." (Mentions the
  leader in an ordinary capacity.)
- **+1 anchor:** "The new rule protects millions of workers' retirement savings. Here is what it
  means for you and how to learn more." (Centers the policy, the institution, and the public.)

### 6. Function — Persuasion/advocacy (−1) ↔ Information/service (+1)
Whether the message mainly tries to win an argument or spin events, or mainly informs and serves
the public.

- **−1 anchor:** "The fake impeachment hoax is collapsing. Everyone knows the truth — total
  vindication!"
- **0 anchor:** "Our plan cuts costs for families. Learn how the new tax credit works." (Promotes
  policy while informing.)
- **+1 anchor:** "Travel advisory: Level 4 – Do Not Travel. U.S. citizens should depart
  immediately. Contact the Embassy at +1-…" (Alerts, deadlines, how-tos, factual announcements.)

---

## Categorical codes

**Villain** (NPF character; the main antagonist blamed or attacked, if any):
`none`, `pol` (domestic political opponents), `media`, `immig` (immigrants, migrants, cartels,
gangs framed through immigration), `foreign` (foreign governments, terrorists, adversaries),
`legal` (courts, judges, prosecutors, investigations), `bureau` (bureaucracy, "deep state,"
agency officials), `corp` (corporations, elites, Big Tech, banks), `crime` (domestic criminals),
`other`.

**Topic** (primary policy area): `econ`, `immig`, `foreign` (also defense and diplomacy),
`health` (also COVID), `justice`, `culture` (social issues, religion, DEI, education culture
war), `elections`, `energy` (also environment and climate), `gov` (government operations,
personnel, nominations), `ceremony` (holidays, commemorations, condolences, sports, greetings),
`media`, `other`.

---

## Measurement pipeline

1. **Teacher labels.** A stratified random sample of non-repost posts was labeled by Claude
   (Anthropic) using this codebook, blind to source. A random subset was labeled a second time
   later in the session to estimate intra-coder reliability.
2. **Student model.** Ridge and gradient-boosting regressors, one per dimension, trained on the
   teacher labels. Features are TF-IDF word and character n-grams, GloVe-Twitter embeddings,
   VADER sentiment, and stylometric features (capitals ratio, exclamation marks, emoji, insult
   lexicon, and so on). Cross-validated agreement with the teacher labels is reported in
   `analysis/validation.md`.
3. **External ideology benchmark.** A separate classifier trained only on ~400k tweets from
   members of Congress (2017–2023), labeled by party, gives every post a *party-language slant*:
   the probability that its language comes from a Republican member. It shares no labels with
   step 1, so it serves as an independent convergent-validity check on the ideology dimension.
