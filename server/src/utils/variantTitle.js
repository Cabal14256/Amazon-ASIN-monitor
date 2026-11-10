function hasConcreteTitle(title) {
  return typeof title === 'string' && title.trim().length > 0;
}

function applyParentTitleGate(hasVariants, parentAsin, parentTitle) {
  if (!hasVariants || !parentAsin) {
    return Boolean(hasVariants);
  }

  return hasConcreteTitle(parentTitle);
}

module.exports = {
  applyParentTitleGate,
  hasConcreteTitle,
};
