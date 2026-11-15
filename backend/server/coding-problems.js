const twoSumStarters = {
  Python: `import sys\n\ndef solve(nums, target):\n    # TODO: return the indices of the two numbers that add up to target.\n    return []\n\ndata = list(map(int, sys.stdin.read().split()))\nnums, target = data[:-1], data[-1]\nprint(*solve(nums, target))\n`,
  JavaScript: `const values = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconst target = values.pop();\nconst nums = values;\n\nfunction solve(nums, target) {\n  // TODO: return the two indices.\n  return [];\n}\n\nconsole.log(solve(nums, target).join(' '));\n`,
  Java: `import java.util.*;\n\npublic class Main {\n  static int[] solve(int[] nums, int target) {\n    // TODO: return the two indices.\n    return new int[0];\n  }\n\n  public static void main(String[] args) {\n    Scanner scanner = new Scanner(System.in);\n    List<Integer> values = new ArrayList<>();\n    while (scanner.hasNextInt()) values.add(scanner.nextInt());\n    int target = values.remove(values.size() - 1);\n    int[] nums = values.stream().mapToInt(Integer::intValue).toArray();\n    int[] answer = solve(nums, target);\n    if (answer.length == 2) System.out.println(answer[0] + " " + answer[1]);\n  }\n}\n`,
  'C++': `#include <iostream>\n#include <vector>\nusing namespace std;\n\nvector<int> solve(vector<int>& nums, int target) {\n    // TODO: return the two indices.\n    return {};\n}\n\nint main() {\n    vector<int> values;\n    int value;\n    while (cin >> value) values.push_back(value);\n    int target = values.back();\n    values.pop_back();\n    vector<int> answer = solve(values, target);\n    if (answer.size() == 2) cout << answer[0] << " " << answer[1] << "\\n";\n    return 0;\n}\n`
};

const reverseWordsStarters = {
  Python: `import sys\n\nwords = sys.stdin.read().split()\n# TODO: reverse the word order and print the sentence.\nprint("")\n`,
  JavaScript: `const words = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).filter(Boolean);\n// TODO: reverse the word order and print the sentence.\nconsole.log('');\n`,
  Java: `import java.util.*;\n\npublic class Main {\n  public static void main(String[] args) {\n    Scanner scanner = new Scanner(System.in);\n    List<String> words = new ArrayList<>();\n    while (scanner.hasNext()) words.add(scanner.next());\n    // TODO: reverse the word order and print the sentence.\n    System.out.println("");\n  }\n}\n`,
  'C++': `#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n\nint main() {\n    vector<string> words;\n    string word;\n    while (cin >> word) words.push_back(word);\n    // TODO: reverse the word order and print the sentence.\n    cout << "\\n";\n    return 0;\n}\n`
};

const parenthesesStarters = {
  Python: `import sys\n\ns = sys.stdin.read().strip()\n# TODO: print true when the brackets are balanced, otherwise false.\nprint("false")\n`,
  JavaScript: `const s = require('fs').readFileSync(0, 'utf8').trim();\n// TODO: print true when the brackets are balanced, otherwise false.\nconsole.log('false');\n`,
  Java: `import java.util.*;\n\npublic class Main {\n  public static void main(String[] args) {\n    String s = new Scanner(System.in).nextLine().trim();\n    // TODO: print true when the brackets are balanced, otherwise false.\n    System.out.println("false");\n  }\n}\n`,
  'C++': `#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string s;\n    getline(cin, s);\n    // TODO: print true when the brackets are balanced, otherwise false.\n    cout << "false\\n";\n    return 0;\n}\n`
};

const longestSubstringStarters = {
  Python: `import sys\n\ns = sys.stdin.read().strip()\n# TODO: print the length of the longest substring without repeating characters.\nprint(0)\n`,
  JavaScript: `const s = require('fs').readFileSync(0, 'utf8').trim();\n// TODO: print the length of the longest substring without repeating characters.\nconsole.log(0);\n`,
  Java: `import java.util.*;\n\npublic class Main {\n  public static void main(String[] args) {\n    String s = new Scanner(System.in).nextLine().trim();\n    // TODO: print the length of the longest substring without repeating characters.\n    System.out.println(0);\n  }\n}\n`,
  'C++': `#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string s;\n    getline(cin, s);\n    // TODO: print the length of the longest substring without repeating characters.\n    cout << 0 << "\\n";\n    return 0;\n}\n`
};

const mergeIntervalsStarters = {
  Python: `import sys\n\nlines = [line for line in sys.stdin.read().strip().splitlines() if line.strip()]\nn = int(lines[0])\nintervals = [tuple(map(int, line.split())) for line in lines[1:1 + n]]\n# TODO: merge overlapping intervals and print each as "start end".\nprint("")\n`,
  JavaScript: `const lines = require('fs').readFileSync(0, 'utf8').trim().split(/\\r?\\n/).filter(Boolean);\nconst n = Number(lines[0]);\nconst intervals = lines.slice(1, 1 + n).map(line => line.trim().split(/\\s+/).map(Number));\n// TODO: merge overlapping intervals and print each as "start end".\nconsole.log('');\n`,
  Java: `import java.util.*;\n\npublic class Main {\n  public static void main(String[] args) {\n    Scanner scanner = new Scanner(System.in);\n    int n = scanner.nextInt();\n    int[][] intervals = new int[n][2];\n    for (int i = 0; i < n; i++) {\n      intervals[i][0] = scanner.nextInt();\n      intervals[i][1] = scanner.nextInt();\n    }\n    // TODO: merge overlapping intervals and print each as "start end".\n  }\n}\n`,
  'C++': `#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    vector<pair<int, int>> intervals(n);\n    for (auto& interval : intervals) cin >> interval.first >> interval.second;\n    // TODO: merge overlapping intervals and print each as "start end".\n    return 0;\n}\n`
};

export const codingProblems = [
  {
    key: 'two-sum', title: 'Two Sum', difficulty: 'Easy', topics: ['Arrays', 'Hash map'],
    summary: 'Find the two indices in an integer array whose values add up to a target.',
    description: 'You are given an array of integers and a target value. Return the indices of the two numbers that add up to the target. Each input has exactly one solution, and you may not use the same element twice. Print the indices in ascending order.',
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i], target <= 10^9', 'Exactly one valid answer exists'],
    examples: [{ input: '2 7 11 15\n9', output: '0 1', explanation: 'nums[0] + nums[1] = 2 + 7 = 9.' }],
    starters: twoSumStarters,
    tests: [
      { input: '2 7 11 15\n9', expected_output: '0 1' },
      { input: '3 2 4\n6', expected_output: '1 2' },
      { input: '3 3\n6', expected_output: '0 1' },
      { input: '-1 -2 -3 -4 -5\n-8', expected_output: '2 4', hidden: true }
    ]
  },
  {
    key: 'reverse-words', title: 'Reverse Words', difficulty: 'Easy', topics: ['Strings', 'Two pointers'],
    summary: 'Reverse the order of words in a sentence while keeping each word intact.',
    description: 'Read one line containing words separated by spaces. Print the words in reverse order, separated by a single space. Leading and trailing spaces should not appear in the output.',
    constraints: ['1 <= sentence length <= 10^4', 'Words contain printable characters only'],
    examples: [{ input: 'the sky is blue', output: 'blue is sky the', explanation: 'The word order is reversed; the letters inside each word stay the same.' }],
    starters: reverseWordsStarters,
    tests: [
      { input: 'the sky is blue', expected_output: 'blue is sky the' },
      { input: 'hello world', expected_output: 'world hello' },
      { input: 'one', expected_output: 'one' },
      { input: '  practice   makes   progress  ', expected_output: 'progress makes practice', hidden: true }
    ]
  },
  {
    key: 'valid-parentheses', title: 'Valid Parentheses', difficulty: 'Medium', topics: ['Strings', 'Stack'],
    summary: 'Decide whether a string of brackets is balanced and correctly nested.',
    description: 'Given a string containing only the characters ( ) [ ] { }, print true when every opening bracket is closed by the matching bracket in the correct order. Otherwise print false.',
    constraints: ['1 <= s.length <= 10^4', 's contains only bracket characters'],
    examples: [{ input: '()[]{}', output: 'true', explanation: 'Each pair closes in the correct order.' }, { input: '(]', output: 'false', explanation: 'The opening parenthesis is closed by a square bracket.' }],
    starters: parenthesesStarters,
    tests: [
      { input: '()[]{}', expected_output: 'true' },
      { input: '(]', expected_output: 'false' },
      { input: '([{}])', expected_output: 'true' },
      { input: '((', expected_output: 'false', hidden: true }
    ]
  },
  {
    key: 'longest-substring', title: 'Longest Unique Substring', difficulty: 'Medium', topics: ['Strings', 'Sliding window'],
    summary: 'Find the length of the longest substring that does not repeat a character.',
    description: 'Given a string, print the length of the longest contiguous substring that contains no repeated characters.',
    constraints: ['0 <= s.length <= 5 * 10^4', 's contains printable ASCII characters'],
    examples: [{ input: 'abcabcbb', output: '3', explanation: 'The longest unique substring is "abc".' }],
    starters: longestSubstringStarters,
    tests: [
      { input: 'abcabcbb', expected_output: '3' },
      { input: 'bbbbb', expected_output: '1' },
      { input: 'pwwkew', expected_output: '3' },
      { input: 'dvdf', expected_output: '3', hidden: true }
    ]
  },
  {
    key: 'merge-intervals', title: 'Merge Intervals', difficulty: 'Hard', topics: ['Sorting', 'Intervals'],
    summary: 'Merge every set of overlapping intervals and print the merged ranges.',
    description: 'The first line contains n, the number of intervals. Each of the next n lines contains a start and end value. Merge all overlapping or touching intervals and print each merged interval on its own line as "start end", ordered by start.',
    constraints: ['1 <= n <= 10^4', '0 <= start <= end <= 10^9'],
    examples: [{ input: '4\n1 3\n2 6\n8 10\n15 18', output: '1 6\n8 10\n15 18', explanation: 'The first two intervals overlap, so they become 1 6.' }],
    starters: mergeIntervalsStarters,
    tests: [
      { input: '4\n1 3\n2 6\n8 10\n15 18', expected_output: '1 6\n8 10\n15 18' },
      { input: '2\n1 4\n2 3', expected_output: '1 4' },
      { input: '3\n1 2\n3 4\n5 6', expected_output: '1 2\n3 4\n5 6' },
      { input: '5\n1 10\n2 3\n4 8\n9 12\n20 25', expected_output: '1 12\n20 25', hidden: true }
    ]
  }
];

export function getCodingProblem(key) {
  return codingProblems.find(problem => problem.key === key) || null;
}

export function publicCodingProblem(problem) {
  return {
    key: problem.key,
    title: problem.title,
    difficulty: problem.difficulty,
    topics: problem.topics,
    summary: problem.summary,
    description: problem.description,
    constraints: problem.constraints,
    examples: problem.examples,
    starters: problem.starters,
    test_count: problem.tests.length,
    sample_tests: problem.tests.filter(test => !test.hidden).map(test => ({ input: test.input, expected_output: test.expected_output }))
  };
}
