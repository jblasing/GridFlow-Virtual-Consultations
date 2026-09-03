function selectSpecialist(assignedUserUids, defaultSpecialist, coltSpecialist) {
  return assignedUserUids.includes(coltSpecialist.userUid)
    ? coltSpecialist
    : defaultSpecialist;
}

module.exports = { selectSpecialist };
