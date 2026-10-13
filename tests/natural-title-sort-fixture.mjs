export function checkTitleSorting(sort,assert){
  for(const marker of ['Book','Volume','Vol.','Part']){
    const titles=['Six','Three','Two','10','One','Twenty-One','21st','Twentieth','First','One Hundred and Two'].map(n=>'Series '+marker+' '+n);
    const sorted=[...titles].sort(sort.compare),values=sorted.map(t=>Number(/\d+/.exec(sort.key(t))[0]));
    assert(JSON.stringify(values)===JSON.stringify([1,1,2,3,6,10,20,21,21,102]),'Written/numeric order failed: '+marker);
    assert(titles[0]==='Series '+marker+' Six','Sorting changed displayed titles');
  }
  assert(sort.key('Series Vol. Twenty-First: A Story')==='Series Volume 21: A Story','Compound ordinal or subtitle lost');
  assert(sort.key('Series Book 02')==='Series Book 2','Explicit numeric marker changed incorrectly');
  assert(sort.compare('Series Volume Two','Series Vol. 10')<0,'Mixed volume marker forms failed');
  for(const title of ['One Piece','The Twenty-One Steps','A Book of Two Cities','Part of the Story','Series (1999) #21','Series Annual #2','Volume Control','Book Twofold','Series Book Many','Series #1/2'])assert(sort.key(title)===title,'Unrelated title transformed: '+title);
  const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
  for(const [a,b]of [['Series #2','Series #10'],['Title (1999)','Title (2001)'],['One Piece','Two Brothers']])assert(Math.sign(sort.compare(a,b))===Math.sign(collator.compare(a,b)||a.localeCompare(b)),'Existing non-volume sorting changed');
}
