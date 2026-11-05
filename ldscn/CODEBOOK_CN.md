# Codebook: Christian nationalism in LDS general-authority discourse

## Purpose

This codebook measures, passage by passage, how far a speaker's words express agreement or disagreement
with the five statements in PRRI's Christian Nationalism Scale (PRRI, *A Christian Nation?
Understanding the Threat of Christian Nationalism to American Democracy and Culture*, 2023). Aggregated
over passages, talks and years, it gives a time series from the 1850s to the present that is comparable
in meaning to PRRI's survey measure.

Survey respondents answer every item. Speakers do not. A passage usually says nothing about most items,
so each item is coded **not addressed** unless the passage gives evidence of how the speaker would
answer. The analysis reports two things separately:

- **Salience:** how often the topic comes up at all.
- **Stance:** where the speaker stands when it does.

## The five PRRI statements

| Code | Statement |
|---|---|
| **Q1 GOV** | The U.S. government should declare America a Christian nation. |
| **Q2 LAW** | U.S. laws should be based on Christian values. |
| **Q3 FOUND** | If the U.S. moves away from our Christian foundations, we will not have a country anymore. |
| **Q4 IDENT** | Being Christian is an important part of being truly American. |
| **Q5 DOMIN** | God has called Christians to exercise dominion over all areas of American society. |

## Scale for each item

The scale mirrors PRRI's four response options, plus "not addressed".

| Value | Meaning |
|---|---|
| +2 | Completely agree. Explicit, unhedged endorsement of the proposition. |
| +1 | Mostly agree. The passage implies endorsement, or endorses a softer or conditional version. |
| 0 | Not addressed. No evidence either way. This is the default. |
| −1 | Mostly disagree. The passage implies rejection, or favors a principle in tension with the item. |
| −2 | Completely disagree. Explicit rejection of the proposition. |

## General rules

1. **America-specific.** The items concern the United States. Statements about the Kingdom of God, Zion,
   Israel, other nations or the world in general are not coded on Q1–Q5. They go in the supplemental
   codes below. A passage about Zion or the Saints' own community governing itself is **THEO**, not Q5,
   unless it is about governing American society.
2. **"Christian" includes the restored gospel.** Speakers who frame the nation's religious basis as God,
   Christ, the Bible, "Christian principles" or the restored gospel are coded the same way. A speaker
   who says other churches are apostate can still agree that America must rest on God's law.
3. **Code what the speaker asserts or plainly implies, not what they quote to refute.** Reported views
   of opponents are not coded as the speaker's view.
4. **Scripture.** Quoting scripture counts when the speaker applies it to the United States. The usual
   cases are Ether 2:9–12 (the promised land, whose nation must serve God or be swept off), 2 Nephi 1:7,
   D&C 101:77–80 (the Constitution established by God) and D&C 134.
5. **One passage can carry several items, and conflicting signals.** Code each item on the dominant
   thrust of the passage for that item.
6. **Do not infer from tone alone.** Patriotism, gratitude for America or prayers for the nation are
   **AMER** (civil religion), not Q1–Q5, unless tied to one of the propositions.

## Item guidance

**Q1 GOV (official Christian identity of the state)**

- Agree: "this is a Christian nation"; the nation, government or Congress should formally acknowledge God
  or Christ; official prayers, oaths or national acts are what make America God's nation.
- Disagree: government should not establish or prefer any religion; "we do not believe it just to mingle
  religious influence with civil government" (D&C 134:9); Article of Faith 11 applied to the state.

**Q2 LAW (law grounded in Christian values)**

- Agree: civil law should rest on God's or Christian moral law; legislation on marriage, the Sabbath,
  alcohol, gambling or abortion justified because God's law requires it; "moral law is the foundation of
  civil law."
- Disagree: the government should not impose a majority's religious morality, especially on religious
  minorities. The 19th-century polygamy-era argument that Congress may not legislate the religion of the
  Saints is −1 or −2. The same goes for arguments that law must protect the conscience of people of all
  faiths or none.
- When a speaker says the law should follow God's law *and* opposes laws imposing Protestant morality on
  Saints, code the stance the passage argues most. Note the tension in the rationale.

**Q3 FOUND (national survival depends on Christian foundations)**

- +2: if America forsakes God, Christ or its religious foundations it will fall, be destroyed or "swept
  off" ("we will not have a country").
- +1: the conditional promised-land covenant (Ether 2) applied to the United States; the nation's liberty
  and prosperity depend on its righteousness or faith.
- Disagree: the nation's strength rests on secular or pluralist institutions, not on a particular faith.

**Q4 IDENT (Christianity as part of true Americanism)**

- Agree: being a believer or Christian is part of being a true or good American; unbelievers or
  secularists are un-American; faith and patriotism are fused into one identity.
- Disagree: true Americanism is religious liberty for all faiths and none; people of any religion are
  equally American.

**Q5 DOMIN (called to govern American society)**

- Agree: believers, or the Saints, are called to take charge of or govern American society, institutions
  or culture. Examples: the elders will rule the nation; the Kingdom of God will govern America; "the
  Constitution will hang by a thread and the elders will save it" when framed as the Church taking
  governing control.
- Disagree: the Church stays out of partisan politics; political neutrality; members should be good
  citizens under existing law rather than seek control.

## Supplemental codes

Each supplemental code is 0, 1 or 2, by salience.

| Code | What it captures |
|---|---|
| **THEO** | Kingdom-of-God or Zion theocracy: the Church or Kingdom of God as a government that will rule the earth or the Saints' own society, without the claim being about the United States. Central to 19th-century discourse; kept separate so it is not mistaken for American Christian nationalism. |
| **AMER** | American civil religion: America as a choice or promised land, the Constitution as divinely inspired, the founders as raised up by God, patriotic devotion. Gorski's civil-religious tradition, distinct from Christian nationalism unless an item is also coded. |
| **ANTI** | The U.S. government or nation cast as Babylon, persecutor or doomed gentile nation. Common 1850s–1880s. |
| **LIB** | Religious liberty or pluralism affirmed as a principle for all people. Not just the Saints' own freedom. |

## Indices

- **Passage stance:** the mean of the item scores that are addressed (−2 to +2).
- **PRRI-equivalent score:** item scores mapped to PRRI's 1–4 scale (completely disagree = 1, mostly
  disagree = 2, mostly agree = 3, completely agree = 4) and averaged over the items a talk addresses.
- **Talk categories,** following PRRI's adherents, sympathizers, skeptics and rejecters:
  - Adherent: 3.5 or above.
  - Sympathizer: 2.5–3.49.
  - Skeptic: 1.5–2.49.
  - Rejecter: below 1.5.

  Only talks that address at least one item are classified.
- **Salience:** the share of passages, or of words, addressing any item, by year.
- **Endorsement rate:** the sum of positive item scores per 10,000 words. This combines salience and
  stance.

## Unit of analysis

The coded unit is a passage of about 300 words (150–450), aligned to paragraphs. Full talks run 1,500 to
over 10,000 words in the 19th century and mix many subjects; a talk-level code would blur a single
paragraph on the Constitution into a sermon on tithing. Passage codes aggregate up to talks, conferences,
speakers and years.
