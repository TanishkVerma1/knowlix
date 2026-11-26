# Prompt log

The main AI prompts Team Knowlix used to plan and build this website, in the order we used them. The tool was Claude Code. Prompts are quoted as written, with lightly trimmed whitespace.

The prompts Knowlix itself sends to its AI roles at runtime are a separate thing. Those are the Planner, Finder, Writer, Judge and Critic personas, documented in [`docs/AGENT_PERSONAS.md`](docs/AGENT_PERSONAS.md).

---

## Phase 1: planning (before 26 Nov)

1. **Analyse the brief and research the market.**
   > "Now i have a hackathon in my college in 2 days and i have attached each and everything for your understanding. i want you to go through every image and then research some existing solution if available online and identify their gaps and all. Now there are 2 documents in the folder that my team member has sent. Go through these documents also. … create a document to list all the improvements that should be made to both of these documents so that we are making this as a extremely extraordinary project … All the marks in phase 1 is given to you … also phase 2 requirements grading system is also given … add a section in the document in which you will include possibilities that would be given to us to add or fine tune this system"

2. **Deliver the plan as a PDF.**
   > "also i dont want an artifact i want you to make a pdf of that file."

3. **Rework against the official guidelines.**
   > "there is folder in which there are guidelines document. now read them and then again work on improvements of project"

4. **Explain the whole system, including the multi-agent architecture.**
   > "alright now i need you to explain me each and everything we are doing in this project like what we are going to build and how, are we going to make multi agent architecture, etc.. every detail about the project.."

5. **Merge teammates' suggestions.**
   > "Alright these are statements told by my other two team mates i want you check if everything related to these were considered for our document or not: …" then "yes update the document.."

6. **Review the Phase 1 deck against the plan.**
   > "now i teammate has made the knowlix phase 1 deck tell me is it according to our finalized improvement plan … or there are any improvements to be made, etc." then "ok now if there are things to be changed in my document according to the html then go ahead and do it.."

7. **Plan an implementation that can be demoed.**
   > "Also tell me how you are going to implement this project to make it extraordinary, easy to understand, things working perfectly. and also make sure that when i am showing the project then i can show a demo to the people of working of our project."

8. **Benchmark against existing tools.**
   > "also you have seen how the mendeley, zotero, research rabbit, scispace work right and have understood how we have to make this project accordingly to that right?"

## Phase 1: building the first version (25 Nov)

9. **Build it, with personas and guardrails.**
   > "i said the project shouild be extraordinary exceptionally well dont work on it based on the level of the presentation/deck. the ui/ux has to be exceptionally good and error free. also i have docker desktop for you to use.. also if you can give personals to agent, guardrails, etc so that agent works properly then do that also.. go ahead and create this extremely well, extraordinary working and looking, no issues and faults, etc project."

10. **Structure the code.**
    > "also if you feel like structuring like frontend backend, etc then you can"

11. **Design decisions (answered in a structured questionnaire).**
    - Sign-in: *"Private workspace, no sign-in."*
    - AI keys: *"None yet."* (build with a mock AI and a no-AI mode)
    - Demo scene: *"Projector or big screen in a hall."*
    - Visual direction: *"make it the best as per you … plan it yourself"*

12. **Make the agents' design visible.**
    > "and the agents md file doesnt have the personas for the agents? how would i know whether agents have personas and guardrails, etc"

13. **Test it hard, explain the verdicts, show the agents working (25 Nov, evening).**
    > "Now i need you to test the project and also check whether the project right now is good for various edge cases. and make sure that all things that are required from this hackathon phase 1 are in this project and also ready for phase 2. tell me whether dataset is used in this project if yes then where can i see it. where have we taken it from. do we need to have more data for training and testing with various edge cases, for making this a better project. Also the reasons for verifying, mismatch and please check, should be easily understandable. i mean i didnt understand why it is retracted and also when everything is scoring marks in the field by field. Also is there a better way where we can see that the agents are running. How can we overcome the limitations listed in the project. […] also this is a live project i should see the project running the agents working and their outputs clearly."

    What came out of it:
    - An adversarial edge-case test pass (2 critical and 16 major defects found and fixed, including a way to turn a retracted paper "Verified").
    - A 300-reference test set built from random Crossref and DataCite records, browsable inside the app.
    - "Why this stamp?": three plain questions on every reference (does it exist, do the details match, is it safe to cite).
    - A live agent room that streams each AI agent's answer as it is typed, on a real model.
    - More databases (Europe PMC, Semantic Scholar, arXiv, Google Books) and full-text checking for free-to-read papers.
    - A Draft page: the student writes, Knowlix inserts citations from the checked library and flags copied wording.

## 26 Nov, morning: before the day-of brief

14. **A new look, with nothing else allowed to break.**
    > "I wanted you to change the look and feel also. so please redesign to make this extraordinary project but remember nothing else like the working and all should not break. then also tell me what api you need and where to put it."

    What came out of it: the "registrar's record" look (ink-teal shell, wide heavy titles on a braided rule, colour reserved for verdicts), applied through shared design tokens so no behaviour changed. The full test suite and the end-to-end checks were re-run afterwards.

15. **Documents and links.**
    > "continue.. and also i heard my other peers at the hackathon saying they can upload documents, links, etc so is my project doing if not then i think we have fullfilled all the requirements of the hackathon."

    What came out of it: a pasted link is read on the server (private network addresses are refused) and checked by its DOI; a PDF is read on the student's own device and never uploaded; an essay PDF's reference list can be lifted straight into the audit.

16. **Privacy of the contact email.**
    > "should i put my personal email in the env file?"

    What came out of it: the answer was no (use a team address), and a fix: the contact address is now sent only to the scholarly databases, never to an arbitrary web page a student pastes.

17. **Sign-ups.**
    > "guide me for getting api of openalex"

18. **Will free API keys cope?**
    > "also as i have the free keys and i saw the agents given the max tokens is it not a lot as per the free api keys that i am giving?"

    What came out of it: Groq's documentation showed the model the app asked for had been switched off for free accounts, and that the free allowance is small per minute. The app now uses Groq's current models, sends a shorter reading list when the allowance is small, moves to the next model when one says "slow down", and waits briefly instead of failing. Tested first with simulated replies, then live.

## Phase 2: day-of adaptation (26 Nov, 1:30 to 3:00 PM)

19. **The day-of brief.**
    > "Also there is a document named ai club hackathon which is for phase 2 that is given to us now so i want you to check these according to my project and whatever is missing or lagging i want you include in the project. also i went and tested a reference exactly as the student pasted them our project counts it as 2 lines or 2 different sites. also i want you to completely match our project level to this document level."

    How it was worked: the brief's test pack (eight references, three requests) was run through the website exactly as written, first as clean text, then as copied from the PDF with its line wraps and letter labels. Every difference between what the brief asks and what the screen showed became a change. Nothing was written for the pack's own references: each change is a general rule, and the pack is kept only as labelled sample test data in `tests/fixtures/`.

    **The six required cases, and the Phase 1 step that handles each**

    | Case | In the pack | What the website shows | Handled by (Phase 1 design) | Changed today |
    |---|---|---|---|---|
    | 1. Invented reference | C | **Not found**, with where it looked: doi.org and Crossref for the DOI, then Crossref and OpenAlex for the title and authors. Never verified, never swapped for a similar paper. | Lock 1, the reference check (code, no AI): step "DOI registered?" then "Looked for the paper you meant" | The label was "Mismatch"; it is now "Not found" and names the places searched. |
    | 2. Real DOI, wrong paper | E | **Mismatch**, with "What this DOI really points to" shown under what the student pasted. | Lock 1: step "Compared details" | A real DOI credited to people who did not write the paper used to be "Please check". It is now Mismatch. |
    | 3. Small error | A | **Needs fix**: "your year does not match", 1981 against 1979. The student clicks **Use the official record** (accept) or **Keep with a reason** / **Remove** (reject). | Lock 1 scoring (title 40, authors 30, year 15, journal 15) and the audit's decision step | The label was "Please check"; it is now "Needs fix". |
    | 4. Retracted paper | D | **Retracted**, in red, with "Safe to cite? Retracted". It cannot be turned into Verified. | Lock 1: step "Retraction notices" (Crossref) | The stamp said "Please check"; it now says "Retracted". |
    | 5. Duplicate | B and G | "Duplicate found: No. 07 is the same paper as No. 02", with a **Merge** button. One entry is kept; the list never prints a paper twice. | The audit's decision step and the export rule "one work, one entry" | Duplicates were dropped quietly at export. Now they are shown and the student merges them. |
    | 6. No source exists | Request 1 | **Not found**: "No source in the databases mentions …, so no study answers your question as you asked it. Nothing was invented." Related real sources are listed below, each checked and labelled "AI suggestion", none approved until the student clicks. | Finder agent plus checkpoint 2 (the student approves sources); Lock 1 checks every source | The explicit "Not found" answer is new. |

    **Bonus cases**

    | Case | In the pack | What the website shows |
    |---|---|---|
    | B1. Real paper, no DOI | F | **Verified** by title and authors in OpenAlex; "No DOI" is only an information flag. |
    | B2. Web page, no author or date | H | **Web source**: "not checked in a scholarly database". Exported in APA 7 with the organisation as author and "n.d.". |
    | B3. Quote not in the source | Request 2 | **Quote not found**: the words are searched for in the sources; "the full text was not available to check here, so this quote is not confirmed". |
    | B4. Database down or slow | (any) | **Not checked**, with a "Check again" button. Never Verified when no check ran. |
    | B5. Instruction hidden in text | Request 3 | "Treated as text, not as a command": notes and pasted text are content. A status changes only when a check runs. |

    **Constraints**

    | Constraint | How the website meets it |
    |---|---|
    | 1. Nothing verified by default | Every reference carries one of Verified, Needs fix, Mismatch, Retracted, Not found, Not checked or Web source, in the audit, the library and every export. The label guide is on the same screens. |
    | 2. The student decides | Fixes, merges, removals and saves are buttons. Nothing is corrected, deleted, swapped or added to the library without a click. |
    | 3. No guessing | Details come only from the registries. If a database does not answer, the status is "Not checked". |
    | 4. Warnings travel with the reference | In an exported list, anything not Verified is marked after the entry, for example "[Retracted: this paper has been withdrawn]". The AI-use statement counts unverified and retracted items. |
    | 5. Stay inside the Phase 1 design | No new workflow: the cases are handled by Lock 1 (reference check), the three checkpoints, the Finder agent and Lock 2 (claim check). |
    | 6. No hard-coding | The rules are general and are covered by unit tests on other references; the pack is used only as labelled sample data. |

    Also fixed from this prompt: a reference pasted with a line break in the middle was being split in two. A journal line ("Econometrica, 47(2), 263–291.") now stays with the reference above it, letter labels ("A.", "B.") are read as list labels, and a DOI cut in two by a line break is joined back together.

20. **Pasting the whole pack at once.**
    > "also what if i pasted all the links given in the document as it is together will it be able to give reviews of each link at one go or not?"

    What came out of it: yes. All eight references pasted together on the Home page come back as eight cards, each with its own status. Testing this showed one more problem: when the heading line ("References, exactly as the student pasted them:") or the page footer a browser prints on a PDF was copied along with the list, the split went wrong. Both are now recognised and ignored, with a unit test.

21. _Add any further prompt used during the 90 minutes here._
