# Codebook: Fascist Rhetoric Index (FRI)

## What this measures, and what it does not

The FRI measures how far a single official post uses rhetorical elements that scholarly definitions
treat as characteristic of fascism. It does **not** classify any person, party, administration or
agency as fascist. Every definition used here stresses that the individual elements also appear
in ordinary politics, and that fascism is a *syndrome*: several elements working together.
Single markers are therefore weak signals, and the index gives most weight to co-occurrence.

The same rules apply to every account, party and period. Several markers are written so that
left-coded content can trigger them: for example, framing opponents as an existential threat to
democracy, or calling a court illegitimate.

## Sources

- Paxton, R. O. (2004). *The Anatomy of Fascism*. The "mobilizing passions": a sense of
  overwhelming crisis; the in-group as victim, which justifies any action against its enemies;
  dread of decadence; the need for a purer community; authority vested in a leader who embodies
  the group's destiny; the beauty of violence; the efficacy of will.
- Griffin, R. (1991). *The Nature of Fascism*. Fascism as "palingenetic ultranationalism": a myth
  of national decay followed by rebirth.
- Eco, U. (1995). "Ur-Fascism." Among his features: the cult of tradition; disagreement treated
  as treason; fear of difference; obsession with a plot; enemies portrayed as both strong and
  weak; life as permanent warfare; selective populism with the leader as the people's
  interpreter.
- Stanley, J. (2018). *How Fascism Works*. The mythic past, victimhood, law and order aimed at
  outgroups, dehumanization, and unreality and attacks on a shared truth.
- Levitsky, S. & Ziblatt, D. (2018). *How Democracies Die*. Four authoritarian indicators:
  rejection of democratic rules, denial of opponents' legitimacy, toleration of violence, and
  readiness to curtail the liberties of opponents and the press.

## Markers

Each marker is scored 0 (absent), 1 (present) or 2 (strong).

| Code | Marker | 1 = present | 2 = strong |
|---|---|---|---|
| **RE** | National decline and rebirth (Griffin; Stanley's mythic past; Eco's cult of tradition) | The nation has declined or been betrayed and must be restored ("make … great again", "golden age is back") | An explicit decay-then-rebirth narrative of national salvation ("our country was being destroyed … it is being reborn") |
| **EN** | Existential enemy or conspiracy (Paxton; Eco's plot; Schmitt's friend–enemy) | Domestic opponents or institutions framed as a threat to the nation, or claims of plots, rigging or a "deep state" | Opponents as traitors, "enemy of the people", or an existential threat to be defeated or removed; an organized conspiracy against the nation |
| **DH** | Dehumanization and purity (Paxton's purer community; Stanley; Eco's fear of difference) | An outgroup essentialized as collectively criminal or dangerous, or framed as an "invasion" | Explicit dehumanizing metaphors (vermin, animals, garbage, poison, infestation, "poisoning the blood") or purity language |
| **LC** | Leader cult (Paxton; Eco's selective populism) | The leader as uniquely capable savior; extravagant praise of the leader's greatness | The leader as the embodiment of the people or nation; demands of personal loyalty; quasi-religious devotion |
| **AD** | Anti-democratic delegitimization (Levitsky & Ziblatt; Eco's disagreement as treason) | Delegitimizing courts, elections, the press or the opposition as corrupt or illegitimate; calls to punish critics | Rejecting election results; calls to jail opponents, revoke the licenses of critical media, suspend rights or set aside constitutional limits |
| **VI** | Violence and force as virtue (Paxton; Eco's permanent warfare and cult of heroism) | Force or domination celebrated as a virtue; relish in threatening domestic targets ("full force", "they will pay") | Threatened or endorsed violence against domestic opponents or groups; glorying in brutality |
| **VG** | Victimhood and retribution (Paxton; Stanley) | The in-group or leader as persecuted victim | Victimhood explicitly used to justify revenge or retribution ("I am your retribution") |

Coding rules:

- Routine enforcement or legal language about an individual case ("ICE arrested X, a criminal
  alien convicted of Y") is 0 on DH unless it generalizes to the whole group or uses invasion,
  infestation or contamination imagery.
- Factual reports of foreign military operations are 0 on VI unless they relish violence or treat
  brutality as a virtue.
- Ordinary credit-claiming for a leader is 0 on LC. Partisan criticism alone is 0 on EN; it needs
  threat, plot or treason framing.
- A slogan counts once at level 1 ("MAKE AMERICA GREAT AGAIN" is RE 1).

## Index

- **FRI (0–100)** = 100 × (sum of the seven marker scores) / 14.
- **Syndrome post** = three or more markers present, at least one of them from the core of
  enemy, dehumanization, anti-democratic or violence markers (EN, DH, AD, VI). Prevalence of
  syndrome posts is the headline measure, because no single marker is diagnostic.

## Measurement

The pipeline follows the main codebook. Claude coded 1,000 posts blind to account and date,
shuffled across accounts and administrations, in two rounds:

1. **F0001–F0800** (`labels/fri_labels.csv`, `make_fri_sample.py`): stratified by voice and period
   (Trump's four account-periods, the @WhiteHouse account under each administration, agencies
   before and during Trump II, officials). Half of each stratum is random; half is selected on the
   earlier text scores (partisan, threatening or leader-centered posts, or posts naming a political,
   media, legal or bureaucratic villain).
2. **G0001–G0200** (`labels/fri_labels2.csv`, `make_fri_sample2.py`): chosen on first-pass index
   scores. 60 top-scoring Trump posts spread across his accounts; 60 top-scoring government posts
   from Trump II; 40 top-scoring government posts from earlier administrations; and 40 random posts
   from the 70th–95th percentile. This adds positives for the rare markers and checks the
   highest-scoring posts from every administration for false alarms. (The 10 top-scoring Obama-era
   and 10 Bush-era government posts were all coded 0, and the model learned from them.)

Selecting which posts to code on their text does not bias what the model learns about text
(E[y | x]).

**Student model** (`pipeline/fri_student.py`). Each marker is rare, so each uses a hurdle model:
P(marker present) is the mean of a logistic regression on word and character TF-IDF plus dense
features and a gradient-boosted classifier on GloVe, VADER, style and SVD features. That probability
is multiplied by the marker's mean coded strength when present. The index is the sum of the seven
expected scores, calibrated to the coder's scale by isotonic regression on out-of-fold predictions.
The marker scores are rescaled so they sum to the calibrated index. The syndrome probability comes
from a logistic model, also isotonic-calibrated. Cross-validated agreement is in
`data/derived/fri_validation.csv`; agreement by sampling stratum is in
`fri_validation_by_stratum.csv`.

**Known weaknesses.**

- Leader cult and violence have few positive examples (34 and 17 posts), so their scores are noisy.
  The index and the syndrome share are the reliable outputs.
- The codes come from one LLM coder. They have not yet been checked against human coders; the
  validation packet in `govcomm/validation/` can be extended for that.
