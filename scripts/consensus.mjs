function essentialVoteCount(candidate) {
  return candidate.auditVotes.filter((vote) => vote === 5).length;
}

function validateVotes(candidate, auditCount) {
  if (
    !Array.isArray(candidate.auditVotes)
    || candidate.auditVotes.length !== auditCount
    || candidate.auditVotes.some(
      (vote) => !Number.isInteger(vote) || vote < 1 || vote > 5,
    )
  ) {
    throw new Error(`${candidate.id} must contain ${auditCount} integer votes from 1 through 5`);
  }
}

export function deriveConsensusRanking(
  candidates,
  { auditCount = 8, selectionThreshold, selectedCount },
) {
  const scored = candidates.map((candidate) => {
    validateVotes(candidate, auditCount);
    return {
      id: candidate.id,
      total: candidate.auditVotes.reduce((sum, vote) => sum + vote, 0),
      essentialVotes: essentialVoteCount(candidate),
    };
  });
  scored.sort(
    (left, right) => right.total - left.total
      || right.essentialVotes - left.essentialVotes
      || left.id.localeCompare(right.id),
  );
  return scored.map((candidate, index) => ({
    id: candidate.id,
    total: candidate.total,
    rank: index + 1,
    selected: index < selectedCount && candidate.total >= selectionThreshold,
  }));
}

export function consensusProblems(frame) {
  const problems = [];
  const consensus = frame.consensus;
  let derived;
  try {
    derived = deriveConsensusRanking(consensus.candidateScores, {
      selectionThreshold: consensus.selectionThreshold,
      selectedCount: consensus.selectedCount,
    });
  } catch (error) {
    return [error.message];
  }
  for (const [index, expected] of derived.entries()) {
    const declared = consensus.candidateScores[index];
    if (
      declared.id !== expected.id
      || declared.total !== expected.total
      || declared.rank !== expected.rank
      || declared.selected !== expected.selected
    ) {
      problems.push(
        `Consensus rank ${expected.rank} must be ${expected.id} `
        + `with total ${expected.total} and selected=${expected.selected}`,
      );
    }
  }
  const derivedSelected = derived.filter((candidate) => candidate.selected).map(({ id }) => id);
  const declaredSelected = frame.selectedMutations.map(({ id }) => id);
  if (
    derivedSelected.length !== consensus.selectedCount
    || [...derivedSelected].sort().join("\0") !== [...declaredSelected].sort().join("\0")
  ) {
    problems.push("Selected mutations must equal the candidates selected by the derived ranking");
  }
  return problems;
}
