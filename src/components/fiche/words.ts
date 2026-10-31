// Petits mots de la fiche et de la bibliothèque : l'élision devant un prénom (« d’Alex », « de Sam »).
export const deName = (name: string) => (/^[aeiouyhàâäéèêëîïôöùûü]/i.test(name) ? `d’${name}` : `de ${name}`);
