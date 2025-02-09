import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class RubyAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeRubyContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeRubyContent(content: string): Promise<AnalysisResult> {
        try {
            // Ruby analiz script'ini oluştur
            const rubyScript = `
require 'parser/current'
require 'json'

class SymbolCollector < Parser::AST::Processor
  attr_reader :symbols, :complexity, :dependencies
  
  def initialize
    @symbols = []
    @complexity = 0
    @dependencies = []
  end
  
  def on_class(node)
    add_symbol(node, 'class')
    super
  end
  
  def on_module(node)
    add_symbol(node, 'module')
    super
  end
  
  def on_def(node)
    add_symbol(node, 'method')
    @complexity += 1
    super
  end
  
  def on_defs(node)
    add_symbol(node, 'class_method')
    @complexity += 1
    super
  end
  
  def on_if(node)
    @complexity += 1
    super
  end
  
  def on_while(node)
    @complexity += 1
    super
  end
  
  def on_until(node)
    @complexity += 1
    super
  end
  
  def on_for(node)
    @complexity += 1
    super
  end
  
  def on_case(node)
    @complexity += 1
    super
  end
  
  def on_rescue(node)
    @complexity += 1
    super
  end
  
  def on_send(node)
    if node.children[1] == :require || node.children[1] == :require_relative
      if node.children[2].type == :str
        @dependencies << node.children[2].children[0]
      end
    end
    super
  end
  
  private
  
  def add_symbol(node, type)
    name = case node.children[0]
           when Symbol
             node.children[0].to_s
           when Parser::AST::Node
             node.children[0].children[1].to_s
           end
    
    @symbols << {
      type: type,
      name: name,
      line: node.loc.line,
      column: node.loc.column,
      end_line: node.loc.last_line,
      end_column: node.loc.last_column,
      documentation: extract_comments(node)
    }
  end
  
  def extract_comments(node)
    comments = []
    node.loc.expression.source_buffer.source_lines[0...node.loc.line].reverse_each do |line|
      break unless line.strip.start_with?('#')
      comments.unshift(line.strip)
    end
    comments.join("\\n")
  end
end

begin
  # Stdin'den kodu oku
  code = STDIN.read
  
  # Parser oluştur
  parser = Parser::CurrentRuby.new
  buffer = Parser::Source::Buffer.new('(string)')
  buffer.source = code
  
  # AST oluştur
  ast = parser.parse(buffer)
  
  # AST analizi yap
  collector = SymbolCollector.new
  collector.process(ast)
  
  # Yorum satırlarını say
  comment_lines = code.lines.count { |line| line.strip.start_with?('#') }
  
  # Sonucu oluştur
  result = {
    success: true,
    symbols: collector.symbols,
    complexity: collector.complexity,
    lines_of_code: code.lines.count,
    comment_lines: comment_lines,
    dependencies: collector.dependencies
  }
  
  puts JSON.generate(result)
rescue => e
  puts JSON.generate({
    success: false,
    error: e.message
  })
end`;

            // Ruby process'ini başlat
            const rubyProcess = spawn('ruby', []);
            
            // Kodu gönder
            rubyProcess.stdin.write(content);
            rubyProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                rubyProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                rubyProcess.stderr.on('data', (data) => {
                    console.error('Ruby analiz hatası:', data.toString());
                });
                rubyProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Ruby analizi başarısız oldu'));
                    }
                });
            });

            const analysisResult = JSON.parse(output);
            
            if (!analysisResult.success) {
                throw new Error(analysisResult.error);
            }

            // Sonuçları VSCode formatına dönüştür
            return {
                ast: this.createASTNode(analysisResult),
                symbols: this.createSymbolsMap(analysisResult.symbols),
                dependencies: this.createDependenciesMap(analysisResult.dependencies),
                metrics: this.createMetrics(analysisResult)
            };

        } catch (error) {
            console.error('Ruby analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'File',
            name: 'root',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: any): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        for (const symbol of symbols) {
            result.set(symbol.name, {
                type: symbol.type,
                name: symbol.name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        symbol.line - 1,
                        symbol.column,
                        symbol.end_line - 1,
                        symbol.end_column
                    )
                ),
                documentation: symbol.documentation
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: string[]): Map<string, string[]> {
        const result = new Map<string, string[]>();
        dependencies.forEach(dep => {
            result.set(dep, []);
        });
        return result;
    }

    private createMetrics(result: any): CodeMetrics {
        return {
            complexity: result.complexity,
            linesOfCode: result.lines_of_code,
            commentLines: result.comment_lines,
            dependencies: result.dependencies.length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                result.complexity,
                result.lines_of_code,
                result.comment_lines
            )
        };
    }

    private calculateMaintainabilityIndex(
        complexity: number,
        linesOfCode: number,
        commentLines: number
    ): number {
        const avgComplexity = complexity / (linesOfCode || 1);
        const commentRatio = commentLines / (linesOfCode || 1);
        
        return Math.max(0, Math.min(100,
            171 -
            5.2 * Math.log(avgComplexity || 1) -
            0.23 * Math.log(linesOfCode || 1) -
            16.2 * Math.log(commentRatio || 0.01)
        ));
    }

    public dispose(): void {
        this.analysisCache.clear();
    }
} 