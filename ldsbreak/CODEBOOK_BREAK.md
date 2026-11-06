# Codebook: rhetoric around policy breaks in LDS general-authority discourse

## Purpose and continuity with the tithing study

This codebook extends the measurement design of Overstreet, "Preserving Policy Through Narrative Transformation: A
Computational Analysis of Mormon Tithing Discourse, 1850–2024."

- It keeps that study's two portable dimensions, commandment↔opportunity and fear↔love, each on the same −1 to +1
  scale with anchors at −1, 0 and +1.
- It adds two dimensions that a race-and-lineage case and a church-program case both require:
  - particularism↔universalism, after Mauss's *All Abraham's Children*;
  - institutional↔personal framing.

The same four dimensions are scored on every topic, treated and control, so that topic-to-topic comparisons around a
break are meaningful.

## Unit

The unit is a passage of about 300 words, aligned to paragraphs. Each passage is shown to the coder with no speaker,
date or source, and passages from all topics and periods are shuffled together.

## Fields

| Field | Values | Meaning |
|---|---|---|
| `rel` | 0 / 1 | The passage substantively engages its candidate topic: at least a sentence of real content, not a passing word. |
| `D1` | −1 … +1 | Commandment (−1) ↔ Opportunity (+1) |
| `D2` | −1 … +1 | Fear (−1) ↔ Love (+1) |
| `D3` | −1 … +1 | Particularism / hierarchy (−1) ↔ Universalism / equality (+1) |
| `D4` | −1 … +1 | Institutional / procedural (−1) ↔ Personal / relational (+1) |
| `flags` | letters | Content flags (below) |

**Score scale.**
- Use −1, −0.5, 0, +0.5 or +1.
- **0** means neutral, balanced, or the dimension is absent.
- **±0.5** means the passage leans clearly but moderately one way.
- **±1** means it matches the anchor's register.

Score the rhetoric the passage uses about its own subject. Quoted opponents count only when the speaker adopts their
framing.

**Relevance by topic.** Relevance is judged against the candidate topic:

- **Race** means race, color, ethnicity or lineage as a basis of status. It covers the priesthood and temple
  restriction or its end, Black people or Africans in relation to the Church, slavery as a racial institution, and
  racial prejudice or equality.
  - "The human race" alone is not relevant.
  - "Slave to sin" alone is not relevant.
- **Minister** means home teaching, visiting teaching, or ministering as an assigned watch-care practice.
  - "Ministering of angels" is not relevant.
  - Generic "minister to the poor" is relevant only when it describes members' assigned watch-care.
- **Control and spillover topics** use their topic name. For example, a tithing passage must say something about
  tithing or offerings.

## Dimension anchors

### D1 Commandment (−1) ↔ Opportunity (+1)

- **−1:** "This is a commandment of the Lord, binding upon every member, and it is not optional. Those who neglect
  it stand under condemnation and will be held accountable. Every priesthood holder must do his duty, and leaders
  must see that it is done and reported."
- **0:** "The Church teaches this principle and explains how it is carried out."
- **+1:** "This is an invitation and a privilege, a sacred opportunity to grow, to bless others and to feel joy. The
  Lord invites us to come freely, and the blessings are ours to receive."

### D2 Fear (−1) ↔ Love (+1)

- **−1:** "Woe unto those who refuse. The judgments of God will fall upon them; they are cursed and will reap the
  consequences of their disobedience."
- **0:** "This is what the scriptures teach, and this is what we should do."
- **+1:** "Our Heavenly Father loves each of His children. With compassion and tenderness we reach out to one another,
  and we feel His love and His peace."

### D3 Particularism / hierarchy (−1) ↔ Universalism / equality (+1)

- **−1:** "These blessings are reserved for a chosen lineage. Those of another seed are not entitled to them in this
  life. God has placed distinctions among His children according to their descent or their faithfulness before they
  came here, and we must not mix what He has separated."
- **0:** No statement about which groups of people receive God's blessings or standing. Most passages on most topics
  score 0.
- **+1:** "All are alike unto God, black and white, bond and free. Every child of God, of every race and nation, is
  invited to receive every blessing. There are no second-class members of this Church."

Ordinary invitations to "all members" do not move D3. It moves only when the passage addresses who belongs or who may
receive blessings across groups such as race, nation, lineage, class or worthiness classes:
- in-group superiority or a lineage restriction leans −;
- explicit inclusion across a group boundary leans +.

### D4 Institutional / procedural (−1) ↔ Personal / relational (+1)

- **−1:** "The program is administered through priesthood channels. Leaders will make assignments, supervise the work,
  report the percentages, and follow the policies and procedures set out in the handbook."
- **0:** A mixture, or general doctrinal exposition.
- **+1:** "I think of a sister who visited a widow every week. They became friends. She listened, wept with her, and
  came to know what she needed before she asked."

## Content flags

**Race passages:**

| Flag | Meaning |
|---|---|
| `L` | Lineage, curse or premortal-worthiness explanation for racial status (Cain, Ham, "less valiant") |
| `R` | The restriction is acknowledged, explained or defended |
| `V` | The 1978 revelation or Official Declaration 2 is referred to |
| `E` | Explicit racial equality or universal access, including 2 Nephi 26:33 |
| `A` | Racism or racial prejudice is condemned |
| `G` | Growth or presence of the Church among Black or African people |
| `S` | Slavery as a racial institution |
| `N` | Native Americans, Lamanites or other non-Black groups as the racial subject |

**Minister passages:**

| Flag | Meaning |
|---|---|
| `P` | Program metrics: percentages, monthly visits, reports, assignments supervised |
| `C` | Care for individuals, ministering to the one, friendship, needs-based visiting |
| `M` | Uses the post-2018 "ministering" vocabulary for the program |
| `H` | Uses "home teaching" or "visiting teaching" vocabulary |
